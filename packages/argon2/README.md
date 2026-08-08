# @thomasfosterau/argon2

argon2id password hashing that works on **Cloudflare Workers** — the RustCrypto [`argon2`](https://crates.io/crates/argon2) crate compiled to `wasm32-unknown-unknown`, wrapped in a small TypeScript API.

```sh
npm install @thomasfosterau/argon2
```

```ts
import { hashPassword, verifyPassword } from "@thomasfosterau/argon2";

const phc = await hashPassword("correct horse battery staple");
// "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>"

await verifyPassword(phc, "correct horse battery staple"); // true
await verifyPassword(phc, "hunter2"); // false
```

No dependencies, and nothing to configure. The functions return `Promise`s so they drop into password-hashing contracts that expect async (Better Auth's `emailAndPassword.password.{hash,verify}`, for one), but the work underneath is synchronous.

## Why this exists

Node-native argon2 bindings don't run on workerd, and the pure-JS implementations are slow enough to blow a request's CPU budget. The usual wasm route has its own problem on this runtime, though:

- **The computation must be synchronous.** workerd has no async task pool, so anything that wants to spawn a `Worker` is refused outright. This module does the hashing on the calling thread.
- **Instantiation must happen at startup.** Workers permits synchronous `WebAssembly.Module` construction while a module is being evaluated and forbids it inside a request. The wasm is therefore compiled once at module scope — moving it into a lazy per-call path would break on the platform while still passing every local test.
- **The wasm must not be an asset import.** Importing a `.wasm` file needs a bundler-specific suffix (`?url` / `?inline` for Vite, `?module` / `?init` for the Cloudflare rolldown plugin). Instead the bytes are embedded as a base64 string constant — plain JavaScript, with no resolution behaviour to get wrong, identical under every bundler and test runner.

The published `dist/` already contains that constant, so **consumers need no Rust toolchain**.

## Parameters

OWASP's second recommended argon2id option, for memory-constrained environments: **19 MiB, 2 iterations, 1 degree of parallelism** — measured at ~28 ms per hash inside a Workers isolate.

Salts are 16 random bytes from `crypto.getRandomValues` (the crate is built without `rand_core`, so the target needs no `getrandom` syscall surface).

Cost parameters are encoded into every PHC string and `verifyPassword` reads them from the stored hash rather than from the constants above, so raising them does not invalidate existing hashes.

## Development

Needs a Rust toolchain with the wasm target:

```sh
rustup target add wasm32-unknown-unknown
```

From the repository root:

```sh
vp run -r build   # cargo build -> src/wasm.generated.ts -> dist/
vp check          # format, lint, type-check
vp run -r test    # Vitest, against the real compiled wasm
```

`src/wasm.generated.ts` is **not committed**: it is regenerated from `src/lib.rs` by the `build:wasm` task, which every other task depends on, so the artifact can never drift from the Rust source.

## License

[MIT](LICENSE)
