/**
 * Tests for the parameterised `hash` / `verify` pair, and the fixtures that
 * pin `hashPassword` / `verifyPassword` to what 0.1.1 published.
 *
 * Like `password.test.ts`, these run the real wasm module — there is no mock.
 *
 * @module tests/argon2
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  Argon2Error,
  hash,
  hashPassword,
  verify,
  verifyPassword,
  wasmModule,
  type Argon2ErrorCode,
} from "../src/index.ts";
import { FIXED_SALT, PUBLISHED_0_1_1, REFERENCE, VERSION_16 } from "./fixtures/hashes.ts";

const PASSWORD = "correct horse battery staple";

/** Cheap costs, so the many cases below stay fast. */
const CHEAP = { memoryKiB: 64, iterations: 1 } as const;

/** The `code` of the `Argon2Error` that `run` throws. */
function codeOf(run: () => unknown): Argon2ErrorCode | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof Argon2Error) return error.code;
    throw error;
  }
  return undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compatibility with 0.1.1", () => {
  it.each(PUBLISHED_0_1_1)("verifyPassword accepts a hash 0.1.1 wrote (%#)", async (fixture) => {
    expect(await verifyPassword(fixture)).toBe(true);
    expect(await verifyPassword({ hash: fixture.hash, password: `${fixture.password}!` })).toBe(
      false,
    );
  });

  it.each(PUBLISHED_0_1_1)(
    "hashPassword writes what 0.1.1 wrote for the same salt (%#)",
    async (fixture) => {
      vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
        if (array instanceof Uint8Array) array.set(FIXED_SALT);
        return array;
      });
      expect(await hashPassword(fixture.password)).toBe(fixture.hash);
    },
  );

  it.each(PUBLISHED_0_1_1)("hash with no options matches hashPassword (%#)", (fixture) => {
    expect(hash(fixture.password, { salt: FIXED_SALT })).toBe(fixture.hash);
    expect(verify(fixture.password, fixture.hash)).toBe(true);
  });
});

describe("hash", () => {
  it.each(REFERENCE)("matches the reference implementation (%#)", (fixture) => {
    expect(hash(PASSWORD, fixture.options)).toBe(fixture.hash);
    expect(verify(PASSWORD, fixture.hash)).toBe(true);
    expect(verify("not the password", fixture.hash)).toBe(false);
  });

  it("hashes a Uint8Array as it would the same string, and leaves it intact", () => {
    const bytes = new TextEncoder().encode(PASSWORD);
    expect(hash(bytes, { ...CHEAP, salt: FIXED_SALT })).toBe(
      hash(PASSWORD, { ...CHEAP, salt: FIXED_SALT }),
    );
    expect(new TextDecoder().decode(bytes)).toBe(PASSWORD);
  });

  it("generates a fresh salt of the requested length", () => {
    const first = hash(PASSWORD, { ...CHEAP, saltLength: 8 });
    const second = hash(PASSWORD, { ...CHEAP, saltLength: 8 });
    expect(first).not.toBe(second);
    // 8 bytes are 11 unpadded base64 characters.
    expect(first.split("$")[4]).toHaveLength(11);
  });

  it.each([
    ["the smallest memory cost for one lane", { memoryKiB: 8, iterations: 1 }],
    ["the smallest memory cost for four lanes", { memoryKiB: 32, iterations: 1, parallelism: 4 }],
    ["the shortest digest", { ...CHEAP, hashLength: 10 }],
    ["the longest digest", { ...CHEAP, hashLength: 64 }],
    ["the shortest salt", { ...CHEAP, salt: new Uint8Array(8) }],
    ["the longest salt", { ...CHEAP, salt: new Uint8Array(48) }],
    ["the shortest generated salt", { ...CHEAP, saltLength: 8 }],
    ["the longest generated salt", { ...CHEAP, saltLength: 48 }],
  ])("accepts %s", (_label, options) => {
    expect(verify(PASSWORD, hash(PASSWORD, options))).toBe(true);
  });

  it.each([
    ["an unknown variant", { variant: "argon2x" as "argon2id" }],
    ["a memory cost below 8 KiB per lane", { memoryKiB: 7 }],
    ["a memory cost below 8 KiB for each of four lanes", { memoryKiB: 31, parallelism: 4 }],
    ["a fractional memory cost", { memoryKiB: 64.5 }],
    ["a memory cost beyond wasm32", { memoryKiB: 4_194_304 }],
    ["a NaN memory cost", { memoryKiB: Number.NaN }],
    ["zero iterations", { iterations: 0 }],
    ["fractional iterations", { iterations: 1.5 }],
    ["iterations beyond 32 bits", { iterations: 2 ** 32 }],
    ["zero lanes", { parallelism: 0 }],
    ["more lanes than argon2 allows", { parallelism: 0x100_0000 }],
    ["a digest one byte too short", { hashLength: 9 }],
    ["a digest one byte too long", { hashLength: 65 }],
    ["a salt one byte too short", { salt: new Uint8Array(7) }],
    ["a salt one byte too long", { salt: new Uint8Array(49) }],
    ["a salt that is not bytes", { salt: "saltsalt" as unknown as Uint8Array }],
    ["a generated salt one byte too short", { saltLength: 7 }],
    ["a generated salt one byte too long", { saltLength: 49 }],
    ["both a salt and a salt length", { salt: FIXED_SALT, saltLength: 16 }],
  ])("rejects %s before entering wasm", (_label, options) => {
    const entered = vi.spyOn(WebAssembly.Instance.prototype, "exports", "get");
    expect(codeOf(() => hash(PASSWORD, options))).toBe("invalid-parameters");
    expect(entered).not.toHaveBeenCalled();
  });

  it("rejects a password that is neither a string nor bytes", () => {
    expect(codeOf(() => hash(42 as unknown as string))).toBe("invalid-parameters");
    expect(codeOf(() => verify(42 as unknown as string, REFERENCE[0].hash))).toBe(
      "invalid-parameters",
    );
  });
});

describe("verify", () => {
  const stored = hash(PASSWORD, { ...CHEAP, salt: FIXED_SALT });

  it("tells a wrong password from a match without throwing", () => {
    expect(verify(PASSWORD, stored)).toBe(true);
    expect(verify("Correct horse battery staple", stored)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["not a PHC string", "not-a-hash"],
    ["a foreign PBKDF2 hash from the previous scheme", "pbkdf2-sha256$100000$c2FsdA$aGFzaA"],
    ["truncated — digest segment missing", "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ"],
    ["truncated — salt and digest missing", "$argon2id$v=19$m=19456,t=2,p=1"],
    ["a digest that is not base64", "$argon2id$v=19$m=64,t=1,p=1$c2FsdHNhbHQ$!!!!!!!!!!!!!!"],
  ])("reports malformed-hash for %s", (_label, value) => {
    expect(codeOf(() => verify(PASSWORD, value))).toBe("malformed-hash");
  });

  it.each([
    ["another algorithm", "$scrypt$ln=16,r=8,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA"],
    ["an unknown argon2 version", stored.replace("v=19", "v=20")],
    ["a memory cost argon2 does not allow", stored.replace("m=64", "m=4")],
    [
      "a salt shorter than argon2 allows",
      "$argon2id$v=19$m=64,t=1,p=1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaA",
    ],
  ])("reports unsupported-hash for %s", (_label, value) => {
    expect(codeOf(() => verify(PASSWORD, value))).toBe("unsupported-hash");
  });

  it("verifies a version 16 hash, and reads a hash with no version as version 16", () => {
    expect(verify(PASSWORD, VERSION_16)).toBe(true);
    expect(verify(PASSWORD, VERSION_16.replace("$v=16", ""))).toBe(true);
    expect(verify(PASSWORD, stored.replace("$v=19", ""))).toBe(false);
  });

  describe("limits on a stored hash's costs", () => {
    it.each([
      ["memory above the default 128 MiB", stored.replace("m=64", "m=131073")],
      ["iterations above the default 10", stored.replace("t=1", "t=11")],
      ["lanes above the default 8", stored.replace("m=64", "m=128").replace("p=1", "p=9")],
      ["gigabytes of memory", stored.replace("m=64", "m=4194303")],
      ["billions of iterations", stored.replace("t=1", "t=4294967295")],
    ])("refuses %s without doing the work", (_label, hostile) => {
      const started = performance.now();
      expect(codeOf(() => verify(PASSWORD, hostile))).toBe("unsupported-hash");
      expect(performance.now() - started).toBeLessThan(1_000);
    });

    it("accepts costs exactly at a limit and refuses one above it", () => {
      const atLimit = hash(PASSWORD, { memoryKiB: 128, iterations: 3, parallelism: 2 });
      const limits = { maxMemoryKiB: 128, maxIterations: 3, maxParallelism: 2 };
      expect(verify(PASSWORD, atLimit, limits)).toBe(true);
      expect(codeOf(() => verify(PASSWORD, atLimit, { ...limits, maxMemoryKiB: 127 }))).toBe(
        "unsupported-hash",
      );
      expect(codeOf(() => verify(PASSWORD, atLimit, { ...limits, maxIterations: 2 }))).toBe(
        "unsupported-hash",
      );
      expect(codeOf(() => verify(PASSWORD, atLimit, { ...limits, maxParallelism: 1 }))).toBe(
        "unsupported-hash",
      );
    });

    it("lets a caller raise a limit", () => {
      const costly = hash(PASSWORD, { memoryKiB: 64, iterations: 11 });
      expect(codeOf(() => verify(PASSWORD, costly))).toBe("unsupported-hash");
      expect(verify(PASSWORD, costly, { maxIterations: 11 })).toBe(true);
    });

    it.each([
      ["a zero memory limit", { maxMemoryKiB: 0 }],
      ["a fractional iteration limit", { maxIterations: 1.5 }],
      ["a negative lane limit", { maxParallelism: -1 }],
    ])("rejects %s", (_label, options) => {
      expect(codeOf(() => verify(PASSWORD, stored, options))).toBe("invalid-parameters");
    });
  });

  it("rejects a stored hash that is not a string", () => {
    expect(codeOf(() => verify(PASSWORD, undefined as unknown as string))).toBe(
      "invalid-parameters",
    );
  });
});

describe("a failed allocation", () => {
  // Just under 4 GiB: more than a wasm32 memory can ever grow to once the
  // module's own pages are counted, so the allocation fails and the module
  // (built with `panic = "abort"`) traps.
  const unallocatable = { memoryKiB: 4_194_303, iterations: 1 };

  it("fails with internal, keeping the trap as the cause", () => {
    try {
      hash(PASSWORD, unallocatable);
      expect.unreachable("the allocation should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(Argon2Error);
      expect((error as Argon2Error).code).toBe("internal");
      expect((error as Argon2Error).cause).toBeInstanceOf(WebAssembly.RuntimeError);
    }
  });

  it("leaves every later call working, on a fresh instance", async () => {
    const instantiated = vi.spyOn(WebAssembly, "Instance");
    expect(codeOf(() => hash(PASSWORD, unallocatable))).toBe("internal");
    expect(instantiated).toHaveBeenCalledTimes(1);

    const next = hash(PASSWORD, { ...CHEAP, salt: FIXED_SALT });
    expect(verify(PASSWORD, next)).toBe(true);
    expect(await verifyPassword({ hash: await hashPassword(PASSWORD), password: PASSWORD })).toBe(
      true,
    );
    expect(instantiated).toHaveBeenCalledTimes(1);
  });

  it("is what an over-large stored hash does to verifyPassword, which has no limits", async () => {
    const hostile = PUBLISHED_0_1_1[0].hash.replace("m=19456", "m=4194303");
    await expect(verifyPassword({ hash: hostile, password: PASSWORD })).rejects.toMatchObject({
      code: "internal",
    });
    expect(await verifyPassword(PUBLISHED_0_1_1[0])).toBe(true);
  });
});

describe("wasmModule", () => {
  it("is the compiled module, exporting the documented C ABI", () => {
    expect(wasmModule).toBeInstanceOf(WebAssembly.Module);
    expect(
      WebAssembly.Module.exports(wasmModule)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([
      "alloc",
      "dealloc",
      "hash",
      "hash_with",
      "last_ptr",
      "memory",
      "verify",
      "verify_with",
    ]);
    expect(WebAssembly.Module.imports(wasmModule)).toEqual([]);
  });

  it("can be instantiated and driven by a caller directly", () => {
    const { exports } = new WebAssembly.Instance(wasmModule, {});
    expect(typeof exports["hash_with"]).toBe("function");
  });
});
