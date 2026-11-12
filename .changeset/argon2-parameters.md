---
"@thomasfosterau/argon2": minor
---

Add `hash` and `verify`: synchronous functions that take the argon2 parameters and report why a verification could not be done.

- `hash(password, options?)` chooses the variant (`argon2id` by default, `argon2i`, `argon2d`), the memory, iteration and parallelism costs, the digest length, and the salt (supplied, or generated at a chosen length). Out-of-range arguments are rejected before any work is done.
- `verify(password, hash, options?)` returns `true` or `false` for a match or a wrong password, and throws an `Argon2Error` whose `code` is `malformed-hash`, `unsupported-hash`, `invalid-parameters` or `internal` for everything else. It refuses a stored hash that asks for more than 128 MiB of memory, 10 iterations or 8 lanes — limits a caller can change — so a corrupt or hostile hash cannot make verification expensive.
- `wasmModule` exports the compiled `WebAssembly.Module`, with its C ABI documented, so an adapter no longer needs to embed the wasm bytes itself.
- Passwords may be passed as a `Uint8Array`. Password and salt copies are wiped from the module's memory after use, and an allocation the runtime cannot make now fails with an `Argon2Error` and leaves later calls working.

`hashPassword` and `verifyPassword` are unchanged: their output is pinned, byte for byte, to hashes written by 0.1.1.

On Cloudflare Workers the package needs a compatibility date of 2025-06-01 or later, or the `allow_eval_during_startup` flag. That was already true of 0.1.x; it is now documented and tested against the real `workerd` runtime.
