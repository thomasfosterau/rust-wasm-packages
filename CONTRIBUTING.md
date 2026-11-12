# Contributing

This is a pnpm monorepo managed by [Vite+](https://viteplus.dev) (the `vp` CLI). Each package is a Rust crate compiled to WebAssembly with a thin TypeScript wrapper — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the shape of a package and the platform constraints behind it.

## Setup

You need Node (see `engines` in `package.json`), a Rust toolchain installed with rustup, and `vp` (or use `./node_modules/.bin/vp` after a `pnpm install`):

```sh
vp install
```

`rust-toolchain.toml` names the `wasm32-unknown-unknown` target, so rustup installs it the first time cargo runs here.

## The loop

One command runs everything CI runs, in order, and stops at the first failure:

```sh
vp run ci
```

CI runs exactly that, on Node's LTS and current release lines. The steps it is made of, for running one at a time:

```sh
vp run -r build   # cargo build -> src/wasm.generated.ts -> dist/
vp check          # format (Oxfmt), lint (Oxlint), type-check (tsgolint); --fix to autofix
vp run -r test    # every package's Vitest suite, against the real compiled wasm
```

Build first on a clean checkout: `src/wasm.generated.ts` is generated, never committed, and nothing type-checks until `build:wasm` has emitted it.

## Pull requests

- Branch from `trunk` and keep `vp check` clean. Lint rules are not disabled inline; a rule that truly cannot apply gets a scoped override in `vite.config.ts` with its reason.
- Every user-visible change ships with a changeset: `vp run changeset`. While a package is `0.x`, a breaking change is a `minor` bump.
- Adding a package: mirror `packages/argon2`, as described in [AGENTS.md](AGENTS.md#adding-a-package).

Releases are automated from the changesets on `trunk` — see [docs/RELEASING.md](docs/RELEASING.md).
