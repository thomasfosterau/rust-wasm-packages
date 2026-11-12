# `@thomasfosterau/argon2`

Design notes for the argon2id package. For installation and usage, see its [README](../packages/argon2/README.md).

## Why this exists

Node-native argon2 bindings don't run on workerd, and the pure-JS implementations are slow enough to blow a request's CPU budget. The package is the RustCrypto [`argon2`](https://crates.io/crates/argon2) crate compiled to `wasm32-unknown-unknown`, built around the three platform constraints in [ARCHITECTURE.md](ARCHITECTURE.md): the hashing is synchronous, the wasm is instantiated once at module scope, and the bytes are embedded as a base64 constant rather than imported as an asset.

The functions return `Promise`s so they drop into password-hashing contracts that expect async (Better Auth's `emailAndPassword.password.{hash,verify}`, for one), but the work underneath is synchronous.

## Two pairs of functions

|                      | `hashPassword` / `verifyPassword`     | `hash` / `verify`                                   |
| -------------------- | ------------------------------------- | --------------------------------------------------- |
| Returns              | a `Promise`                           | the value, synchronously                            |
| Variant              | argon2id                              | argon2id (default), argon2i, argon2d                |
| Costs, salt, digest  | fixed (see [Parameters](#parameters)) | chosen by the caller                                |
| A bad stored value   | `false`, never an exception           | an `Argon2Error` with a `code`                      |
| A costly stored hash | computed, whatever it asks for        | refused above the [limits](#limits-on-verification) |
| Password             | a `string`                            | a `string` or a `Uint8Array`                        |

`hashPassword` and `verifyPassword` are unchanged from 0.1.x, byte for byte: the tests pin their output to hashes the published 0.1.1 package wrote. One thing about their failure path did change: when the runtime cannot allocate the memory a hash asks for, they now reject with an `Argon2Error` whose code is `internal` (the trap is its `cause`) where 0.1.x let the raw `WebAssembly.RuntimeError` through, and the calls after it work. With no options, `hash` writes exactly what `hashPassword` writes.

```ts
import { Argon2Error, hash, verify } from "@thomasfosterau/argon2";

const stored = hash(password, { memoryKiB: 65_536, iterations: 3, parallelism: 4 });

try {
  if (!verify(password, stored)) return "wrong password";
} catch (error) {
  if (error instanceof Argon2Error) return error.code; // why it could not be checked
  throw error;
}
```

### Options for `hash`

| Option        | Default      | Allowed                                      |
| ------------- | ------------ | -------------------------------------------- |
| `variant`     | `"argon2id"` | `"argon2id"`, `"argon2i"`, `"argon2d"`       |
| `memoryKiB`   | 19456        | an integer from 8 × `parallelism` to 4194303 |
| `iterations`  | 2            | an integer from 1 to 4294967295              |
| `parallelism` | 1            | an integer from 1 to 16777215                |
| `hashLength`  | 32           | 10 to 64 bytes, what a PHC string can carry  |
| `salt`        | generated    | a `Uint8Array` of 8 to 48 bytes              |
| `saltLength`  | 16           | 8 to 48 bytes; not together with `salt`      |

Anything else is rejected with `invalid-parameters` before the wasm module is entered. `parallelism` sets the number of lanes, which changes the digest; the lanes are computed one after another on the calling thread, so it does not make hashing faster.

Hashes are always written at argon2 version 19 (0x13). `verify` also accepts version 16 (0x10), and reads a hash with no version field as version 16, as the argon2 encoding specifies.

### Errors

`hash` and `verify` throw `Argon2Error`, whose `code` is one of:

| `code`               | Meaning                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid-parameters` | An argument is the wrong type or out of range.                                                                                                                  |
| `malformed-hash`     | The stored value is not a PHC string with a salt and a digest.                                                                                                  |
| `unsupported-hash`   | The stored value is a PHC string, but not an argon2 hash that will be verified: an unknown algorithm or version, invalid parameters, or costs above the limits. |
| `internal`           | The computation failed — in practice, the memory cost could not be allocated. The original error is the `cause`.                                                |

A wrong password is not an error: `verify` returns `false`.

### Limits on verification

The costs of a verification come from the stored hash, and a stored hash may be corrupt or written by an attacker. `verify` therefore refuses, with `unsupported-hash` and before reserving any memory, a hash that asks for more than:

| Option           | Default          |
| ---------------- | ---------------- |
| `maxMemoryKiB`   | 131072 (128 MiB) |
| `maxIterations`  | 10               |
| `maxParallelism` | 8                |

Each default is twice the largest value in any profile below. Raise a limit if you store hashes above it; lower them to what you actually write. `verifyPassword` has no limits — it computes whatever the stored hash asks for, and an allocation it cannot make surfaces as an `Argon2Error` with code `internal`.

## Parameters

The defaults are OWASP's second recommended argon2id option, for memory-constrained environments: **19 MiB, 2 iterations, 1 degree of parallelism**.

| Profile | `memoryKiB` | `iterations` | `parallelism` | Source                              | Time per hash in workerd |
| ------- | ----------- | ------------ | ------------- | ----------------------------------- | ------------------------ |
| Default | 19456       | 2            | 1             | OWASP, second option                | about 27 ms              |
| Server  | 65536       | 3            | 4             | RFC 9106, second recommended option | about 194 ms             |

OWASP's other argon2id options trade memory for iterations, down to 7 MiB at 5 iterations. The times were measured by the test suite inside `workerd` on one x86-64 development machine; they are all CPU time, and they scale with memory × iterations. A Worker has a CPU-time limit per request, so measure on your own plan before choosing the server profile there.

Salts are 16 random bytes from `crypto.getRandomValues` (the crate is built without `rand_core`, so the target needs no `getrandom` syscall surface).

Cost parameters are encoded into every PHC string, and verification reads them from the stored hash rather than from the module's constants, so raising them does not invalidate existing hashes.

## On Cloudflare Workers

The wasm is compiled while the module is being evaluated. Workers allows that only when the Worker's compatibility date is **2025-06-01 or later**, or the `allow_eval_during_startup` compatibility flag is set. The test suite runs the built package inside `workerd` and pins what happens:

| Compatibility date and flags                   | Result                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2025-06-01                                     | Works: hashing and verifying inside a `fetch` handler.                                                |
| 2025-05-31                                     | The Worker fails during startup: `WebAssembly.Module(): Wasm code generation disallowed by embedder`. |
| 2025-05-31 with `allow_eval_during_startup`    | Works.                                                                                                |
| 2025-06-01 with `disallow_eval_during_startup` | Fails during startup, as above.                                                                       |

Compiling inside a request is forbidden at every date, which is why this package never compiles lazily.

## Memory and concurrency

- **Secrets.** The copies of the password and the salt in the module's memory are overwritten with zeros before they are released, and so is the encoded copy of a `string` password. argon2's working memory is wiped by the crate's `zeroize` feature. A JavaScript `string` cannot be wiped, so a caller who needs that passes a `Uint8Array` to `hash` / `verify` and wipes it afterwards.
- **Footprint.** The module's memory grows to fit the largest memory cost used and stays that size, because WebAssembly memory cannot shrink: about 19 MiB at the defaults, 64 MiB after one hash at the server profile.
- **A failed allocation.** The crate is built with `panic = "abort"`, so a memory cost the runtime cannot provide traps. The trapped instance is replaced with a fresh one from the same compiled module and then wiped, the call fails with `internal`, and later calls work. If the replacement cannot be made, the trapped instance is left in place, unwiped.
- **Concurrency.** Each call runs to completion on the calling thread and copies its result out before returning, so two requests in one isolate can never interleave inside the module. Nothing is spawned.

## The low-level entry

`wasmModule` is the compiled `WebAssembly.Module`, exported so that an adapter needing the C ABI does not have to embed the bytes itself. Instantiating it — `new WebAssembly.Instance(wasmModule, {})` — is allowed inside a request, and it imports nothing.

| Export                                                                                     | Returns                                                                                                                                |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `memory`                                                                                   | The linear memory.                                                                                                                     |
| `alloc(len)`                                                                               | A pointer to `len` bytes.                                                                                                              |
| `dealloc(ptr, len)`                                                                        | Nothing; releases a buffer from `alloc`.                                                                                               |
| `hash(password, passwordLen, salt, saltLen, mCost, tCost, pCost)`                          | The length of an argon2id PHC string at `last_ptr()`, or `-1`.                                                                         |
| `hash_with(password, passwordLen, salt, saltLen, variant, mCost, tCost, pCost, outputLen)` | The same; `variant` is 0 (argon2d), 1 (argon2i) or 2 (argon2id). `-1` invalid parameters, `-2` salt cannot be encoded, `-3` failure.   |
| `last_ptr()`                                                                               | A pointer to the last PHC string written.                                                                                              |
| `verify(password, passwordLen, stored, storedLen)`                                         | `1` match, `0` mismatch, `-1` anything else.                                                                                           |
| `verify_with(password, passwordLen, stored, storedLen, maxMCost, maxTCost, maxPCost)`      | `1` match, `0` mismatch, `-1` not a PHC string with salt and digest, `-2` not a verifiable argon2 hash or above a limit, `-3` failure. |

The caller manages memory: `alloc` a buffer, write into it, call, then `dealloc`. `hash` and `verify` are frozen at their 0.1.x behaviour.

## `verifyPassword` never throws

`verifyPassword` returns `false` for a malformed or foreign stored value (a legacy `pbkdf2-sha256$…` hash, say), so one bad row fails verification instead of failing the request. That is deliberate, but it means a call with the wrong argument shape also returns `false` silently, which looks identical to a wrong password. It takes a single object — `verifyPassword({ hash, password })` — not positional arguments.
