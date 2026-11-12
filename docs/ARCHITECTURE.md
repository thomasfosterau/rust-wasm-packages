# Architecture

## The shape of a package

Each package pairs a Rust crate (`src/lib.rs` + `Cargo.toml`) with a thin TypeScript wrapper (`src/index.ts`). `scripts/build-wasm.ts` compiles the crate to `wasm32-unknown-unknown` and writes the bytes into `src/wasm.generated.ts` as a base64 string constant; `vp pack` then bundles the wrapper and that constant into a self-contained `dist/index.js`.

The generated file is **never committed**: the `build:wasm` task regenerates it from the Rust source and every other task depends on it, so the artifact cannot drift from the crate. The published `dist/` does contain it — consumers need no Rust toolchain.

## The three platform constraints

The packages target edge runtimes, Cloudflare Workers (workerd) first. Each constraint below is a platform requirement that local tests will happily pass while production breaks.

1. **The wasm is a base64 string constant, not an asset import.** Importing a `.wasm` file needs a bundler-specific suffix (`?url` / `?inline` for Vite, `?module` / `?init` for the Cloudflare rolldown plugin), so one source can't serve both a Vitest module runner and a deployed Worker bundle. A string constant is plain JavaScript with no resolution behaviour to get wrong, identical under every bundler and test runner.

2. **The wasm is instantiated at module scope.** Workers permits synchronous `WebAssembly.Module` construction while a module is being evaluated and forbids it inside a request. Moving instantiation into a lazy per-call path would break on the platform while still passing every local test.

3. **The computation is synchronous.** workerd has no async task pool and refuses to spawn a `Worker`. Exported functions may return `Promise`s to fit caller contracts, but the work underneath runs on the calling thread.
