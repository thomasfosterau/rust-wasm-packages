# `@thomasfosterau/argon2`

Design notes for the argon2id package. For installation and usage, see its [README](../packages/argon2/README.md).

## Why this exists

Node-native argon2 bindings don't run on workerd, and the pure-JS implementations are slow enough to blow a request's CPU budget. The package is the RustCrypto [`argon2`](https://crates.io/crates/argon2) crate compiled to `wasm32-unknown-unknown`, built around the three platform constraints in [ARCHITECTURE.md](ARCHITECTURE.md): the hashing is synchronous, the wasm is instantiated once at module scope, and the bytes are embedded as a base64 constant rather than imported as an asset.

The functions return `Promise`s so they drop into password-hashing contracts that expect async (Better Auth's `emailAndPassword.password.{hash,verify}`, for one), but the work underneath is synchronous.

## Parameters

OWASP's second recommended argon2id option, for memory-constrained environments: **19 MiB, 2 iterations, 1 degree of parallelism** — measured at ~28 ms per hash inside a Workers isolate.

Salts are 16 random bytes from `crypto.getRandomValues` (the crate is built without `rand_core`, so the target needs no `getrandom` syscall surface).

Cost parameters are encoded into every PHC string and `verifyPassword` reads them from the stored hash rather than from the module's constants, so raising them does not invalidate existing hashes.

## `verifyPassword` never throws

`verifyPassword` returns `false` for a malformed or foreign stored value (a legacy `pbkdf2-sha256$…` hash, say), so one bad row fails verification instead of failing the request. That is deliberate, but it means a call with the wrong argument shape also returns `false` silently, which looks identical to a wrong password. It takes a single object — `verifyPassword({ hash, password })` — not positional arguments.
