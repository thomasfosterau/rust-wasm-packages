/**
 * @copyright Thomas Foster
 *
 * argon2id password hashing for the Cloudflare Workers runtime — an in-repo
 * wrapper over the RustCrypto `argon2` crate, compiled to
 * `wasm32-unknown-unknown` (see `src/lib.rs`).
 *
 * Consumed by `apps/auth`'s Better Auth instance through
 * `emailAndPassword.password.{hash,verify}`. The exported functions are
 * `Promise`-returning to match that contract; the computation underneath is
 * synchronous, which is what makes this viable on workerd — there is no async
 * task pool, and therefore no `Worker` for the runtime to refuse to spawn.
 *
 * The module compiles and instantiates the wasm once, at module scope. That is
 * startup work, not per-request: Workers permits synchronous
 * `WebAssembly.Module` construction during startup and forbids it inside a
 * request, so this must stay at the top level and must not be moved into a
 * lazy per-call path.
 *
 * See docs/decisions/password-hashing.md.
 *
 * @module argon2
 */

import { WASM_BASE64 } from "./wasm.generated.ts";

/**
 * OWASP's second recommended argon2id option, for memory-constrained
 * environments: 19 MiB, 2 iterations, 1 degree of parallelism. Comfortably
 * inside a Workers isolate's memory ceiling — measured at ~28ms per hash.
 *
 * These are encoded into every PHC string, and {@link verifyPassword} reads
 * the cost parameters from the stored hash rather than from here, so raising
 * them does not invalidate existing hashes.
 */
const MEMORY_KIB = 19_456;
const ITERATIONS = 2;
const PARALLELISM = 1;

/** Salt length in bytes — the PHC/argon2 conventional 16. */
const SALT_BYTES = 16;

interface Argon2Exports {
  readonly memory: WebAssembly.Memory;
  readonly alloc: (len: number) => number;
  readonly dealloc: (ptr: number, len: number) => void;
  readonly last_ptr: () => number;
  readonly hash: (
    passwordPtr: number,
    passwordLen: number,
    saltPtr: number,
    saltLen: number,
    memoryKib: number,
    iterations: number,
    parallelism: number,
  ) => number;
  readonly verify: (
    passwordPtr: number,
    passwordLen: number,
    storedPtr: number,
    storedLen: number,
  ) => number;
}

// Returns `Uint8Array<ArrayBuffer>` rather than the default
// `Uint8Array<ArrayBufferLike>`: `WebAssembly.Module` takes a `BufferSource`,
// which does not accept a view over a `SharedArrayBuffer`. Allocating the
// backing buffer explicitly is what narrows it.
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// The module imports nothing (`wasm32-unknown-unknown`, salt supplied by the
// caller), so instantiation needs no import object and behaves identically
// under Vitest's module runner and a deployed Worker.
const wasm = new WebAssembly.Module(decodeBase64(WASM_BASE64));
const exports = new WebAssembly.Instance(wasm, {}).exports as unknown as Argon2Exports;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Copy `bytes` into module memory, returning the pointer and length. */
function write(bytes: Uint8Array): readonly [number, number] {
  const ptr = exports.alloc(bytes.length);
  new Uint8Array(exports.memory.buffer).set(bytes, ptr);
  return [ptr, bytes.length];
}

/**
 * Hash a plaintext password into a self-describing argon2id PHC string
 * (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`).
 *
 * The salt comes from Web Crypto rather than the wasm module — keeping
 * `getrandom` out of the Rust build is what lets it target
 * `wasm32-unknown-unknown` with no syscall surface at all.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const [passwordPtr, passwordLen] = write(encoder.encode(password));
  const [saltPtr, saltLen] = write(salt);
  try {
    const length = exports.hash(
      passwordPtr,
      passwordLen,
      saltPtr,
      saltLen,
      MEMORY_KIB,
      ITERATIONS,
      PARALLELISM,
    );
    if (length < 0) throw new Error("argon2: hashing failed");
    const start = exports.last_ptr();
    return decoder.decode(new Uint8Array(exports.memory.buffer).slice(start, start + length));
  } finally {
    exports.dealloc(passwordPtr, passwordLen);
    exports.dealloc(saltPtr, saltLen);
  }
}

/**
 * Verify a plaintext password against a stored argon2id PHC string.
 *
 * Returns `false` — never throws — for a malformed or foreign stored value
 * (a legacy `pbkdf2-sha256$…` hash, or corrupt data), so a bad row fails
 * verification instead of failing the request.
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const [passwordPtr, passwordLen] = write(encoder.encode(password));
  const [storedPtr, storedLen] = write(encoder.encode(hash));
  try {
    return exports.verify(passwordPtr, passwordLen, storedPtr, storedLen) === 1;
  } finally {
    exports.dealloc(passwordPtr, passwordLen);
    exports.dealloc(storedPtr, storedLen);
  }
}
