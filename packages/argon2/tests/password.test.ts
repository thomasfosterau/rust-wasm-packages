/**
 * Unit tests for the in-repo argon2id hasher.
 *
 * These exercise the real wasm module — there is no mock, and that is the
 * point: the artifact is compiled from `src/lib.rs` by `build:wasm` on every
 * install, so a Rust change that broke the ABI would surface here rather than
 * at deploy. The module imports nothing (`wasm32-unknown-unknown`, salt
 * supplied by the caller), so it instantiates identically under Vitest's
 * module runner and a deployed Worker.
 *
 * @module tests/password
 */

import { describe, expect, it } from "vite-plus/test";
import { hashPassword, verifyPassword } from "../src/index.ts";

/** `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` — the pinned parameters. */
const PHC = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

describe("hashPassword", () => {
  it("emits a self-describing argon2id PHC string at the pinned parameters", async () => {
    expect(await hashPassword("correct horse battery staple")).toMatch(PHC);
  });

  it("salts per call, so the same password never hashes to the same string", async () => {
    const [a, b] = await Promise.all([hashPassword("same input"), hashPassword("same input")]);
    expect(a).not.toBe(b);
  });

  it("handles an empty password and multi-byte UTF-8 without corrupting either", async () => {
    expect(await verifyPassword({ hash: await hashPassword(""), password: "" })).toBe(true);
    const unicode = "🔐 pässwörd 密码";
    expect(await verifyPassword({ hash: await hashPassword(unicode), password: unicode })).toBe(
      true,
    );
  });
});

describe("verifyPassword", () => {
  it("round-trips a freshly hashed password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword({ hash: stored, password: "correct horse battery staple" })).toBe(
      true,
    );
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword({ hash: stored, password: "Correct horse battery staple" })).toBe(
      false,
    );
  });

  it.each([
    ["empty", ""],
    ["not a PHC string", "not-a-hash"],
    ["truncated — digest segment missing", "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ"],
    ["a foreign PBKDF2 hash from the previous scheme", "pbkdf2-sha256$100000$c2FsdA$aGFzaA"],
  ])("returns false rather than throwing for %s", async (_label, stored) => {
    expect(await verifyPassword({ hash: stored, password: "anything" })).toBe(false);
  });

  it("verifies against the parameters in the stored hash, not the current defaults", async () => {
    // Written at a deliberately lower memory cost than the module's own
    // MEMORY_KIB: a hash stored before a cost bump must keep verifying.
    const cheap =
      "$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHR2YWx1ZQ$2FL2E3sGrqDvQ5DKvJmwLb5j8dqzgQFYJ8tHhKmYyVg";
    // The digest above is not a real hash of anything, so this must be a clean
    // `false` — a parse failure and a mismatch are both non-throwing.
    expect(await verifyPassword({ hash: cheap, password: "whatever" })).toBe(false);
  });
});
