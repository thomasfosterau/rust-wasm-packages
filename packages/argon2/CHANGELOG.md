# @thomasfosterau/argon2

## 0.1.0

### Minor Changes

- f7fc6cc: Initial release.

  argon2id password hashing for edge runtimes — the RustCrypto `argon2` crate compiled to `wasm32-unknown-unknown` and embedded in the published bundle as a base64 constant, so consumers need no Rust toolchain and no bundler-specific asset handling.

  Built for Cloudflare Workers specifically: the wasm is instantiated once at module scope (workerd forbids synchronous `WebAssembly.Module` construction inside a request) and the hashing is synchronous (workerd has no async task pool), with `Promise`-returning exports so it drops into contracts that expect async.

  Parameters are OWASP's memory-constrained argon2id recommendation — 19 MiB, 2 iterations, parallelism 1 — encoded into every PHC string, with `verifyPassword` reading cost parameters from the stored hash so they can be raised without invalidating existing hashes.

  Extracted from `thomasfosterau/website`, where it had been in production use; its pre-extraction git history is preserved.
