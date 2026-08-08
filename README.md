# rust-wasm-packages

Good, useful Rust crates made available to JavaScript via WebAssembly — built for edge runtimes (Cloudflare Workers, Deno, browsers) where native bindings can't go and pure-JS implementations are too slow.

| Package                                     | Source                               | Description                                                                   |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| [`@thomasfosterau/argon2`](packages/argon2) | [`packages/argon2`](packages/argon2) | argon2id password hashing — synchronous, dependency-free, workerd-compatible. |

## The shape of a package here

Each package pairs a Rust crate (`src/lib.rs` + `Cargo.toml`) with a thin TypeScript wrapper. The crate compiles to `wasm32-unknown-unknown` and the bytes are embedded in the wrapper as a **base64 string constant**, not imported as an asset.

That last part is deliberate. An asset import needs a bundler-specific suffix (`?url` / `?inline` for Vite, `?module` / `?init` for the Cloudflare rolldown plugin), so the same source can't serve a Vitest module runner and a deployed Worker bundle. A string constant is plain JavaScript with no resolution behaviour to get wrong.

The generated file is **never committed**: `build:wasm` regenerates it from the Rust source, and every other task depends on that, so the artifact cannot drift from the crate. The published `dist/` does contain it — consumers need no Rust toolchain.

## Development

This repository is managed by [Vite+](https://viteplus.dev) (the `vp` CLI), and building needs a Rust toolchain with the wasm target:

```sh
rustup target add wasm32-unknown-unknown

vp install        # install dependencies
vp run -r build   # cargo build -> wasm.generated.ts -> dist/
vp check          # format (Oxfmt), lint (Oxlint), type-check (tsgolint)
vp run -r test    # run every package's Vitest suite
```

Build before checking or testing on a clean checkout: nothing type-checks until `build:wasm` has emitted `src/wasm.generated.ts`.

Releases are automated with [Changesets](https://github.com/changesets/changesets) — see [docs/RELEASING.md](docs/RELEASING.md).

## License

[MIT](LICENSE)
