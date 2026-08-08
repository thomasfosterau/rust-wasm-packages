# Agent Instructions

## Repository Workflow

This repository is managed by [Vite+](https://viteplus.dev): a pnpm monorepo of Rust-crates-as-npm-packages, with all tooling configured in `vite.config.ts`.

- `vp install` — install dependencies (delegates to pnpm)
- `vp run -r build` — `cargo build` → `src/wasm.generated.ts` → `dist/`
- `vp check` — format (Oxfmt), lint (Oxlint), and type-check (tsgolint); `--fix` to autofix
- `vp run -r test` — run every package's Vitest suite

**You need a Rust toolchain with the wasm target**, or nothing works:

```sh
rustup target add wasm32-unknown-unknown
```

**Build before checking or testing on a clean checkout.** Nothing type-checks until `build:wasm` has emitted `src/wasm.generated.ts` — it is gitignored. Every other task declares `dependsOn: ["build:wasm"]`, and CI orders the steps build → check → test.

Use `./node_modules/.bin/vp` if the global `vp` CLI is not installed.

## The three constraints that shape every package here

These are not style preferences — each one is a platform requirement that local tests will happily pass while production breaks.

1. **The wasm is embedded as a base64 string constant, never imported as an asset.** An asset import needs a bundler-specific suffix (`?url` / `?inline` for Vite, `?module` / `?init` for the Cloudflare rolldown plugin), so one source can't serve both a Vitest module runner and a deployed Worker bundle. A string constant is plain JavaScript with no resolution behaviour to get wrong. Do not "improve" this into an asset import.

2. **Instantiate the wasm at module scope, never lazily per call.** Workers permits synchronous `WebAssembly.Module` construction during startup and forbids it inside a request. A lazy per-call path passes every local test and fails on the platform.

3. **The computation stays synchronous.** workerd has no async task pool and refuses to spawn a `Worker`. Exported functions may return `Promise`s to fit caller contracts, but must not depend on real asynchrony underneath.

## The generated artifact is never committed

`src/wasm.generated.ts` is gitignored and rebuilt from `src/lib.rs` on demand, so it cannot drift from the Rust source. That is the trade for not committing a binary. If you find yourself wanting to commit it, fix the build instead.

`build:wasm` is deliberately **uncached** (`cache: false`): cargo does its own incremental caching, and a stale cache hit here would be silently wrong.

## Adding a package

Mirror `packages/argon2`: a `Cargo.toml` (with `publish = false` — the crate goes to npm, not crates.io), `src/lib.rs`, `scripts/build-wasm.ts`, a `vite.config.ts` declaring the `build:wasm` → `build`/`test` task chain, and a `package.json` whose `files` ships `dist` plus the Rust source. Add it to the CI cargo cache key's path list and to `docs/RELEASING.md`.

## Releasing

Changesets + npm Trusted Publishing (OIDC). Every user-visible change ships with a changeset (`vp run changeset`). See [docs/RELEASING.md](docs/RELEASING.md).

The published `dist/` embeds the compiled wasm, so a release built without a Rust toolchain would ship a broken package. Sanity check: `dist/index.js` should be ~100 kB, not ~5 kB.

## History

`packages/argon2` was extracted from `thomasfosterau/website` with `git subtree split`, so its pre-extraction history is intact.
