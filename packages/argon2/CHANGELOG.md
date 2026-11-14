# @thomasfosterau/argon2

## 0.2.0

### Minor Changes

- a910cac: Add `hash` and `verify`: synchronous functions that take the argon2 parameters and report why a verification could not be done.

  - `hash(password, options?)` chooses the variant (`argon2id` by default, `argon2i`, `argon2d`), the memory, iteration and parallelism costs, the digest length, and the salt (supplied, or generated at a chosen length). Out-of-range arguments are rejected before any work is done.
  - `verify(password, hash, options?)` returns `true` or `false` for a match or a wrong password, and throws an `Argon2Error` whose `code` is `malformed-hash`, `unsupported-hash`, `invalid-parameters` or `internal` for everything else. It refuses a stored hash that asks for more than 128 MiB of memory, 10 iterations or 8 lanes — limits a caller can change — so a corrupt or hostile hash cannot make verification expensive.
  - `wasmModule` exports the compiled `WebAssembly.Module`, with its C ABI documented, so an adapter no longer needs to embed the wasm bytes itself.
  - Passwords may be passed as a `Uint8Array`. Password and salt copies are wiped from the module's memory after use, and an allocation the runtime cannot make now fails with an `Argon2Error` and leaves later calls working.

  `hashPassword` and `verifyPassword` are unchanged: their output is pinned, byte for byte, to hashes written by 0.1.1. The one difference is on their failure path: when the runtime cannot allocate the memory a hash asks for, they now reject with an `Argon2Error` whose code is `internal` — the trap is its `cause` — where 0.1.x let the raw `WebAssembly.RuntimeError` through.

  On Cloudflare Workers the package needs a compatibility date of 2025-06-01 or later, or the `allow_eval_during_startup` flag. That was already true of 0.1.x; it is now documented and tested against the real `workerd` runtime.

### Patch Changes

- 2b007b3: Ship `CHANGELOG.md` in the published tarball, so the release notes can be read from `node_modules`.

  Packaging only; no change to the API or the compiled wasm.

- 875e4c3: Shorten the README to what the package is, how to install it and one example, with absolute links to the design notes, architecture and changelog on GitHub.

  Documentation only; no change to the API or the compiled wasm.

## 0.1.1

### Patch Changes

- 02f711e: Fix the `verifyPassword` usage example in the README.

  It showed positional arguments (`verifyPassword(phc, password)`), but the function takes a single object: `verifyPassword({ hash, password })`. Copying the old example silently returned `false` for a correct password — indeed `verifyPassword` never throws by design (so a legacy or corrupt stored hash fails verification rather than failing the request), which means a wrong argument shape looks exactly like a wrong password.

  Documentation only; no change to the API or the compiled wasm.

## 0.1.0

### Minor Changes

- f7fc6cc: Initial release.

  argon2id password hashing for edge runtimes — the RustCrypto `argon2` crate compiled to `wasm32-unknown-unknown` and embedded in the published bundle as a base64 constant, so consumers need no Rust toolchain and no bundler-specific asset handling.

  Built for Cloudflare Workers specifically: the wasm is instantiated once at module scope (workerd forbids synchronous `WebAssembly.Module` construction inside a request) and the hashing is synchronous (workerd has no async task pool), with `Promise`-returning exports so it drops into contracts that expect async.

  Parameters are OWASP's memory-constrained argon2id recommendation — 19 MiB, 2 iterations, parallelism 1 — encoded into every PHC string, with `verifyPassword` reading cost parameters from the stored hash so they can be raised without invalidating existing hashes.

  Extracted from `thomasfosterau/website`, where it had been in production use; its pre-extraction git history is preserved.
