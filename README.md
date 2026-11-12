# rust-wasm-packages

Good, useful Rust crates made available to JavaScript via WebAssembly — built for edge runtimes (Cloudflare Workers, Deno, browsers) where native bindings can't go and pure-JS implementations are too slow.

| Package                                                                                                     | Description                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`@thomasfosterau/argon2`](https://github.com/thomasfosterau/rust-wasm-packages/tree/trunk/packages/argon2) | argon2id password hashing — synchronous, dependency-free, workerd-compatible. |

Each package embeds its compiled wasm, so consumers need no Rust toolchain and no bundler-specific asset handling.

```sh
npm install @thomasfosterau/argon2
```

```ts
import { hashPassword, verifyPassword } from "@thomasfosterau/argon2";

const hash = await hashPassword("correct horse battery staple");
await verifyPassword({ hash, password: "correct horse battery staple" }); // true
```

## Documentation

- [Architecture](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/docs/ARCHITECTURE.md) — the shape of a package and the platform constraints behind it.
- [Contributing](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/CONTRIBUTING.md) — setup, and the build → check → test loop.
- [Releasing](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/docs/RELEASING.md) — Changesets and npm Trusted Publishing.

## License

[MIT](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/LICENSE)
