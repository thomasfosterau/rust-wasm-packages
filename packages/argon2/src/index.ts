/**
 * @copyright Thomas Foster
 *
 * argon2id password hashing for the Cloudflare Workers runtime — a thin
 * wrapper over the RustCrypto `argon2` crate, compiled to
 * `wasm32-unknown-unknown` (see `src/lib.rs`).
 *
 * Two pairs of functions are exported:
 *
 * - {@link hashPassword} / {@link verifyPassword} — fixed parameters, and
 *   `Promise`-returning to drop straight into password-hashing contracts that
 *   expect async (Better Auth's `emailAndPassword.password.{hash,verify}`, for
 *   one). `verifyPassword` never throws for a bad stored value.
 * - {@link hash} / {@link verify} — synchronous, with the variant, costs, salt
 *   and digest length chosen by the caller, and a `verify` that tells a wrong
 *   password apart from a stored value it cannot or will not check.
 *
 * The computation underneath is synchronous either way, which is what makes
 * this viable on workerd — there is no async task pool, and therefore no
 * `Worker` for the runtime to refuse to spawn.
 *
 * The module compiles and instantiates the wasm once, at module scope. That is
 * startup work, not per-request: Workers permits synchronous
 * `WebAssembly.Module` construction during startup and forbids it inside a
 * request, so this must stay at the top level and must not be moved into a
 * lazy per-call path.
 *
 * @module argon2
 */

import { WASM_BASE64 } from "./wasm.generated.ts";

/**
 * OWASP's second recommended argon2id option, for memory-constrained
 * environments: 19 MiB, 2 iterations, 1 degree of parallelism. Comfortably
 * inside a Workers isolate's memory ceiling.
 *
 * These are encoded into every PHC string, and verification reads the cost
 * parameters from the stored hash rather than from here, so raising them does
 * not invalidate existing hashes.
 */
const MEMORY_KIB = 19_456;
const ITERATIONS = 2;
const PARALLELISM = 1;

/** Salt length in bytes — the PHC/argon2 conventional 16. */
const SALT_BYTES = 16;

/** Digest length in bytes. */
const HASH_BYTES = 32;

/** argon2 needs at least 8 salt bytes; a PHC string carries at most 48. */
const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 48;

/** The digest lengths a PHC string can carry. */
const MIN_HASH_BYTES = 10;
const MAX_HASH_BYTES = 64;

/** argon2 needs 8 KiB per lane; wasm32 linear memory ends below 4 GiB. */
const MIN_MEMORY_KIB_PER_LANE = 8;
const MAX_MEMORY_KIB = 4_194_303;
const MAX_ITERATIONS = 0xffff_ffff;
const MAX_PARALLELISM = 0xff_ffff;

/**
 * What {@link verify} will spend on a stored hash unless told otherwise: twice
 * the largest cost in any profile this package documents (64 MiB of memory,
 * 5 iterations, 4 lanes; see `docs/argon2.md`).
 */
const DEFAULT_MAX_MEMORY_KIB = 131_072;
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_PARALLELISM = 8;

/** The argon2 variants. `argon2id` is the one to use unless you know otherwise. */
export type Argon2Variant = "argon2id" | "argon2i" | "argon2d";

/** The argon2 specification's numbering, which the wasm module shares. */
const VARIANT_IDS: Readonly<Record<Argon2Variant, number>> = {
  argon2d: 0,
  argon2i: 1,
  argon2id: 2,
};

/**
 * Why a call failed:
 *
 * - `invalid-parameters` — an argument is the wrong type or out of range.
 * - `malformed-hash` — the stored value is not a PHC string with a salt and a
 *   digest.
 * - `unsupported-hash` — the stored value is a PHC string, but not an argon2
 *   hash that will be verified: an unknown algorithm or version, invalid
 *   parameters, or costs above the limits given to {@link verify}.
 * - `internal` — the computation itself failed, usually because the memory
 *   cost could not be allocated.
 */
export type Argon2ErrorCode =
  | "invalid-parameters"
  | "malformed-hash"
  | "unsupported-hash"
  | "internal";

/** The error {@link hash} and {@link verify} throw; branch on {@link code}. */
export class Argon2Error extends Error {
  override readonly name = "Argon2Error";
  readonly code: Argon2ErrorCode;

  constructor(code: Argon2ErrorCode, message: string, options?: ErrorOptions) {
    super(`argon2: ${message}`, options);
    this.code = code;
  }
}

/** Options for {@link hash}. Every field is optional. */
export interface HashOptions {
  /** Defaults to `"argon2id"`. */
  readonly variant?: Argon2Variant;
  /** Memory cost in KiB, at least 8 per lane. Defaults to 19456 (19 MiB). */
  readonly memoryKiB?: number;
  /** Number of passes. Defaults to 2. */
  readonly iterations?: number;
  /**
   * Number of lanes. Defaults to 1. The lanes are computed one after another
   * on the calling thread, so this changes the digest but not the time taken.
   */
  readonly parallelism?: number;
  /** Digest length in bytes, 10 to 64. Defaults to 32. */
  readonly hashLength?: number;
  /** The salt to use, 8 to 48 bytes. Generated from Web Crypto when absent. */
  readonly salt?: Uint8Array;
  /** Length of the generated salt, 8 to 48 bytes. Defaults to 16. */
  readonly saltLength?: number;
}

/**
 * Limits on what {@link verify} will spend on a stored hash. A hash that asks
 * for more is refused with `unsupported-hash` before any memory is reserved.
 */
export interface VerifyOptions {
  /** Defaults to 131072 (128 MiB). */
  readonly maxMemoryKiB?: number;
  /** Defaults to 10. */
  readonly maxIterations?: number;
  /** Defaults to 8. */
  readonly maxParallelism?: number;
}

/**
 * The module's C ABI. Linear memory is managed by the caller: `alloc` a
 * buffer, write into it, call, then `dealloc`. `hash` and `hash_with` return
 * the length of a PHC string to read at `last_ptr()`, or a negative error
 * code. See `src/lib.rs` for each function's contract.
 */
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
  readonly hash_with: (
    passwordPtr: number,
    passwordLen: number,
    saltPtr: number,
    saltLen: number,
    variant: number,
    memoryKib: number,
    iterations: number,
    parallelism: number,
    hashLen: number,
  ) => number;
  readonly verify_with: (
    passwordPtr: number,
    passwordLen: number,
    storedPtr: number,
    storedLen: number,
    maxMemoryKib: number,
    maxIterations: number,
    maxParallelism: number,
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

/**
 * The compiled argon2 module, for callers that want the C ABI directly
 * (documented in `docs/argon2.md`) without embedding the bytes themselves.
 *
 * Compiled once, here, at module scope: Workers permits synchronous
 * `WebAssembly.Module` construction during startup and forbids it inside a
 * request. Instantiating an already compiled module — `new
 * WebAssembly.Instance(wasmModule, {})` — is allowed anywhere.
 */
export const wasmModule: WebAssembly.Module = new WebAssembly.Module(decodeBase64(WASM_BASE64));

// The module imports nothing (`wasm32-unknown-unknown`, salt supplied by the
// caller), so instantiation needs no import object and behaves identically
// under Vitest's module runner and a deployed Worker.
function instantiate(): Argon2Exports {
  return new WebAssembly.Instance(wasmModule, {}).exports as unknown as Argon2Exports;
}

let instance = instantiate();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Copy two inputs into module memory, run `body` over their pointers, then wipe
 * and release the copies.
 *
 * Every call runs to completion on the calling thread and copies its result
 * out before returning, so two calls can never interleave inside the module.
 *
 * The crate is built with `panic = "abort"`, so a failed allocation (a memory
 * cost the runtime cannot provide) traps. A trapped instance may have stopped
 * half-way through touching its heap, so it is wiped and replaced with a fresh
 * one from the same compiled module; the call fails with `internal`, and the
 * next call starts clean.
 */
function call<Result>(
  first: Uint8Array,
  second: Uint8Array,
  body: (wasm: Argon2Exports, firstPointer: number, secondPointer: number) => Result,
): Result {
  const wasm = instance;
  try {
    const firstPointer = wasm.alloc(first.length);
    const secondPointer = wasm.alloc(second.length);
    new Uint8Array(wasm.memory.buffer).set(first, firstPointer);
    new Uint8Array(wasm.memory.buffer).set(second, secondPointer);
    const result = body(wasm, firstPointer, secondPointer);
    const memory = new Uint8Array(wasm.memory.buffer);
    memory.fill(0, firstPointer, firstPointer + first.length);
    memory.fill(0, secondPointer, secondPointer + second.length);
    wasm.dealloc(firstPointer, first.length);
    wasm.dealloc(secondPointer, second.length);
    return result;
  } catch (cause) {
    new Uint8Array(wasm.memory.buffer).fill(0);
    instance = instantiate();
    throw new Argon2Error("internal", "the computation failed", { cause });
  }
}

/** Read the PHC string the last hash call left in module memory. */
function readResult(wasm: Argon2Exports, length: number): string {
  const start = wasm.last_ptr();
  return decoder.decode(new Uint8Array(wasm.memory.buffer).slice(start, start + length));
}

/**
 * The password as bytes, and whether those bytes are a copy made here. A copy
 * is wiped after use; a caller's own `Uint8Array` is theirs to wipe.
 */
function passwordBytes(password: string | Uint8Array): readonly [Uint8Array, boolean] {
  if (typeof password === "string") return [encoder.encode(password), true];
  if (password instanceof Uint8Array) return [password, false];
  throw new Argon2Error("invalid-parameters", "the password must be a string or a Uint8Array");
}

/** `value`, checked to be an integer in `[min, max]`. */
function integer(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Argon2Error("invalid-parameters", `${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** The salt to hash with: the caller's, or fresh bytes from Web Crypto. */
function resolveSalt(salt: Uint8Array | undefined, saltLength: number | undefined): Uint8Array {
  if (salt === undefined) {
    const length = integer("saltLength", saltLength ?? SALT_BYTES, MIN_SALT_BYTES, MAX_SALT_BYTES);
    return crypto.getRandomValues(new Uint8Array(length));
  }
  if (saltLength !== undefined) {
    throw new Argon2Error("invalid-parameters", "give either salt or saltLength, not both");
  }
  if (!(salt instanceof Uint8Array)) {
    throw new Argon2Error("invalid-parameters", "salt must be a Uint8Array");
  }
  integer("salt length", salt.length, MIN_SALT_BYTES, MAX_SALT_BYTES);
  return salt;
}

/**
 * Hash a password into a self-describing argon2 PHC string
 * (`$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`), choosing the variant, the
 * costs, the salt and the digest length. With no options it produces exactly
 * what {@link hashPassword} does.
 *
 * Synchronous: the work happens on the calling thread, and takes as long as
 * the costs say. A `Uint8Array` password is hashed as given and left for the
 * caller to wipe; a `string` cannot be wiped at all.
 *
 * @throws {Argon2Error} `invalid-parameters` for an argument that is the
 * wrong type or out of range, checked before any work is done; `internal`
 * when the memory cost cannot be allocated.
 */
export function hash(password: string | Uint8Array, options: HashOptions = {}): string {
  const variant = options.variant ?? "argon2id";
  if (!Object.hasOwn(VARIANT_IDS, variant)) {
    throw new Argon2Error("invalid-parameters", "variant must be argon2id, argon2i or argon2d");
  }
  const parallelism = integer(
    "parallelism",
    options.parallelism ?? PARALLELISM,
    1,
    MAX_PARALLELISM,
  );
  const memoryKiB = integer(
    "memoryKiB",
    options.memoryKiB ?? MEMORY_KIB,
    MIN_MEMORY_KIB_PER_LANE * parallelism,
    MAX_MEMORY_KIB,
  );
  const iterations = integer("iterations", options.iterations ?? ITERATIONS, 1, MAX_ITERATIONS);
  const hashLength = integer(
    "hashLength",
    options.hashLength ?? HASH_BYTES,
    MIN_HASH_BYTES,
    MAX_HASH_BYTES,
  );
  const salt = resolveSalt(options.salt, options.saltLength);
  const [bytes, owned] = passwordBytes(password);

  try {
    return call(bytes, salt, (wasm, passwordPtr, saltPtr) => {
      const length = wasm.hash_with(
        passwordPtr,
        bytes.length,
        saltPtr,
        salt.length,
        VARIANT_IDS[variant],
        memoryKiB,
        iterations,
        parallelism,
        hashLength,
      );
      if (length < 0) throw new Error(`hash_with returned ${length}`);
      return readResult(wasm, length);
    });
  } finally {
    if (owned) bytes.fill(0);
  }
}

/**
 * Verify a password against a stored argon2 PHC string of any variant.
 *
 * Returns `true` for a match and `false` for a wrong password, and throws for
 * everything else, so a caller can tell "wrong password" from "this stored
 * value cannot be checked".
 *
 * The cost parameters come from the stored hash, which may be hostile or
 * corrupt, so they are capped: a hash asking for more than
 * {@link VerifyOptions} allows is refused before any memory is reserved.
 *
 * @throws {Argon2Error} `malformed-hash` when the stored value is not a PHC
 * string with a salt and a digest; `unsupported-hash` when it is one but is
 * not an argon2 hash within the limits; `invalid-parameters` for an argument
 * of the wrong type or range; `internal` when the computation fails.
 */
export function verify(
  password: string | Uint8Array,
  stored: string,
  options: VerifyOptions = {},
): boolean {
  if (typeof stored !== "string") {
    throw new Argon2Error("invalid-parameters", "the stored hash must be a string");
  }
  const maxMemoryKiB = integer(
    "maxMemoryKiB",
    options.maxMemoryKiB ?? DEFAULT_MAX_MEMORY_KIB,
    1,
    MAX_MEMORY_KIB,
  );
  const maxIterations = integer(
    "maxIterations",
    options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    1,
    MAX_ITERATIONS,
  );
  const maxParallelism = integer(
    "maxParallelism",
    options.maxParallelism ?? DEFAULT_MAX_PARALLELISM,
    1,
    MAX_PARALLELISM,
  );
  const [bytes, owned] = passwordBytes(password);
  const storedBytes = encoder.encode(stored);

  let outcome: number;
  try {
    outcome = call(bytes, storedBytes, (wasm, passwordPtr, storedPtr) =>
      wasm.verify_with(
        passwordPtr,
        bytes.length,
        storedPtr,
        storedBytes.length,
        maxMemoryKiB,
        maxIterations,
        maxParallelism,
      ),
    );
  } finally {
    if (owned) bytes.fill(0);
  }

  switch (outcome) {
    case 1:
      return true;
    case 0:
      return false;
    case -1:
      throw new Argon2Error("malformed-hash", "the stored value is not a PHC string");
    case -2:
      throw new Argon2Error(
        "unsupported-hash",
        "the stored value is not an argon2 hash within the allowed limits",
      );
    default:
      throw new Argon2Error("internal", `verify_with returned ${outcome}`);
  }
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
  const bytes = encoder.encode(password);
  try {
    return call(bytes, salt, (wasm, passwordPtr, saltPtr) => {
      const length = wasm.hash(
        passwordPtr,
        bytes.length,
        saltPtr,
        salt.length,
        MEMORY_KIB,
        ITERATIONS,
        PARALLELISM,
      );
      if (length < 0) throw new Error("argon2: hashing failed");
      return readResult(wasm, length);
    });
  } finally {
    bytes.fill(0);
  }
}

/**
 * Verify a plaintext password against a stored argon2 PHC string.
 *
 * Returns `false` — never throws — for a malformed or foreign stored value
 * (a legacy `pbkdf2-sha256$…` hash, or corrupt data), so a bad row fails
 * verification instead of failing the request.
 *
 * It spends whatever the stored hash asks for. Where the stored value might
 * be hostile, or the reason for a failure matters, use {@link verify}.
 */
export async function verifyPassword({
  hash: stored,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const bytes = encoder.encode(password);
  const storedBytes = encoder.encode(stored);
  try {
    return call(
      bytes,
      storedBytes,
      (wasm, passwordPtr, storedPtr) =>
        wasm.verify(passwordPtr, bytes.length, storedPtr, storedBytes.length) === 1,
    );
  } finally {
    bytes.fill(0);
  }
}
