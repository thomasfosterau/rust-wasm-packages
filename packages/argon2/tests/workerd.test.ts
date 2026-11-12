/**
 * Runs the built package inside the real Workers runtime.
 *
 * Everything else in this suite runs under Node, which would let this package
 * break on Cloudflare Workers unnoticed: Workers forbids compiling
 * WebAssembly inside a request, and before compatibility date 2025-06-01 it
 * forbade it during startup too. These tests start `workerd` — the runtime
 * Workers itself runs, from the `workerd` npm package — load `dist/index.js`
 * into it, and hash and verify inside a `fetch` handler.
 *
 * There is no skip: a missing `workerd` binary or a missing `dist/index.js`
 * (the `test` task builds it first) fails the suite.
 *
 * @module tests/workerd
 */

import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import workerdBinary from "workerd";
import { verify } from "../src/index.ts";

const bundle = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

/** The Worker under test. It imports the published bundle, unmodified. */
const WORKER = `
import { hash, hashPassword, verify, verifyPassword } from "./argon2.js";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const number = (name, fallback) => Number(url.searchParams.get(name) ?? fallback);

    if (url.pathname === "/roundtrip") {
      const password = url.searchParams.get("password") ?? "";
      const stored = hash(password, { memoryKiB: 64, iterations: 1 });
      // Yield between hashing and verifying, so that two requests in flight
      // at once take turns inside the module.
      await scheduler.wait(25);
      const legacy = await hashPassword(password);
      await scheduler.wait(25);
      return Response.json({
        stored,
        verified: verify(password, stored),
        legacy,
        legacyVerified: await verifyPassword({ hash: legacy, password }),
      });
    }

    if (url.pathname === "/hash") {
      const options = {
        memoryKiB: number("memoryKiB", 19456),
        iterations: number("iterations", 2),
        parallelism: number("parallelism", 1),
      };
      let last = "";
      for (let count = number("count", 1); count > 0; count -= 1) last = hash("password", options);
      return Response.json({ last });
    }

    if (url.pathname === "/exhaust") {
      let code = "none";
      try {
        hash("password", { memoryKiB: 4194303, iterations: 1 });
      } catch (error) {
        code = error.code;
      }
      const stored = hash("password", { memoryKiB: 64, iterations: 1 });
      return Response.json({ code, verifiedAfter: verify("password", stored) });
    }

    return new Response("not found", { status: 404 });
  },
};
`;

interface Runtime {
  readonly origin: string;
  readonly stop: () => void;
}

/** A TCP port nothing is listening on. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === "object") resolve(address.port);
        else reject(new Error("could not reserve a port"));
      });
    });
  });
}

/**
 * Start `workerd` serving {@link WORKER} at the given compatibility date and
 * flags. Resolves once it answers; rejects with its output if it exits first,
 * which is what a Worker that fails during startup does.
 */
async function start(compatibilityDate: string, flags: readonly string[] = []): Promise<Runtime> {
  if (!existsSync(workerdBinary)) throw new Error(`no workerd binary at ${workerdBinary}`);
  if (!existsSync(bundle)) throw new Error(`no built bundle at ${bundle}; run the build first`);

  const directory = mkdtempSync(join(tmpdir(), "argon2-workerd-"));
  const port = await freePort();
  copyFileSync(bundle, join(directory, "argon2.js"));
  writeFileSync(join(directory, "worker.js"), WORKER);
  writeFileSync(
    join(directory, "config.capnp"),
    `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "main", worker = .worker)],
  sockets = [(name = "http", address = "127.0.0.1:${port}", http = (), service = "main")],
);

const worker :Workerd.Worker = (
  modules = [
    (name = "worker.js", esModule = embed "worker.js"),
    (name = "argon2.js", esModule = embed "argon2.js"),
  ],
  compatibilityDate = "${compatibilityDate}",
  compatibilityFlags = [${flags.map((flag) => JSON.stringify(flag)).join(", ")}],
);
`,
  );

  const child: ChildProcess = spawn(workerdBinary, ["serve", join(directory, "config.capnp")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  const stop = (): void => {
    child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  };

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const answered = await Promise.race([
      fetch(origin).then(
        () => true,
        () => false,
      ),
      exited.then(() => "exited" as const),
    ]);
    if (answered === true) return { origin, stop };
    if (answered === "exited") {
      stop();
      throw new Error(`workerd exited during startup:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  stop();
  throw new Error(`workerd did not answer within 20 seconds:\n${output}`);
}

async function getJson(runtime: Runtime, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${runtime.origin}${path}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

describe("inside workerd at compatibility date 2025-06-01", () => {
  let runtime: Runtime;

  beforeAll(async () => {
    runtime = await start("2025-06-01");
  });

  afterAll(() => {
    runtime.stop();
  });

  it("hashes and verifies inside a fetch handler, with both pairs of functions", async () => {
    const result = await getJson(runtime, "/roundtrip?password=correct+horse");
    expect(result).toMatchObject({ verified: true, legacyVerified: true });
    // What the Worker wrote verifies here under Node, and not for another password.
    expect(verify("correct horse", String(result["stored"]))).toBe(true);
    expect(verify("correct horse", String(result["legacy"]))).toBe(true);
    expect(verify("incorrect horse", String(result["stored"]))).toBe(false);
  });

  it("keeps two overlapping requests apart", async () => {
    const [first, second] = await Promise.all([
      getJson(runtime, "/roundtrip?password=first"),
      getJson(runtime, "/roundtrip?password=second"),
    ]);
    expect(first).toMatchObject({ verified: true, legacyVerified: true });
    expect(second).toMatchObject({ verified: true, legacyVerified: true });
    expect(verify("first", String(first["stored"]))).toBe(true);
    expect(verify("first", String(first["legacy"]))).toBe(true);
    expect(verify("second", String(second["stored"]))).toBe(true);
    expect(verify("second", String(second["legacy"]))).toBe(true);
    expect(verify("first", String(second["stored"]))).toBe(false);
    expect(verify("second", String(first["legacy"]))).toBe(false);
  });

  it("survives a memory cost the isolate cannot allocate", async () => {
    expect(await getJson(runtime, "/exhaust")).toEqual({ code: "internal", verifiedAfter: true });
  });

  it.each([
    ["default", "memoryKiB=19456&iterations=2&parallelism=1", 10],
    ["server", "memoryKiB=65536&iterations=3&parallelism=4", 5],
  ])("reports the time per hash at the %s profile", async (profile, query, count) => {
    // Warm up, so that growing the module's memory is not part of the figure.
    const warm = await getJson(runtime, `/hash?${query}&count=1`);
    expect(verify("password", String(warm["last"]), { maxMemoryKiB: 65_536 })).toBe(true);

    const started = performance.now();
    await getJson(runtime, `/hash?${query}&count=${count}`);
    const perHash = (performance.now() - started) / count;
    console.info(`workerd, ${profile} profile (${query}): ${perHash.toFixed(1)} ms per hash`);
    expect(perHash).toBeGreaterThan(0);
  });
});

describe("module-scope compilation and the compatibility date", () => {
  it("fails during startup before 2025-06-01", async () => {
    await expect(start("2025-05-31")).rejects.toThrow(
      /WebAssembly\.Module\(\): Wasm code generation disallowed by embedder/,
    );
  });

  it("starts before 2025-06-01 with allow_eval_during_startup", async () => {
    const runtime = await start("2025-05-31", ["allow_eval_during_startup"]);
    try {
      expect(await getJson(runtime, "/roundtrip?password=flagged")).toMatchObject({
        verified: true,
        legacyVerified: true,
      });
    } finally {
      runtime.stop();
    }
  });

  it("fails during startup on a current date with disallow_eval_during_startup", async () => {
    await expect(start("2025-06-01", ["disallow_eval_during_startup"])).rejects.toThrow(
      /Wasm code generation disallowed by embedder/,
    );
  });
});
