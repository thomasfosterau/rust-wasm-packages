# @thomasfosterau/argon2

argon2id password hashing that works on **Cloudflare Workers**, Deno, browsers and Node — the RustCrypto [`argon2`](https://crates.io/crates/argon2) crate compiled to WebAssembly, wrapped in a small TypeScript API. Synchronous underneath, no dependencies, nothing to configure.

```sh
npm install @thomasfosterau/argon2
```

```ts
import { hashPassword, verifyPassword } from "@thomasfosterau/argon2";

const hash = await hashPassword("correct horse battery staple");
// "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>"

// `verifyPassword` takes a single object, not positional arguments.
await verifyPassword({ hash, password: "correct horse battery staple" }); // true
await verifyPassword({ hash, password: "hunter2" }); // false
```

`verifyPassword` never throws: a malformed stored hash — or a call with the wrong argument shape — returns `false`, exactly like a wrong password.

To choose the costs, salt, digest length or variant, or to tell a wrong password from a stored value that cannot be checked, use the synchronous `hash` and `verify`:

```ts
import { hash, verify } from "@thomasfosterau/argon2";

const stored = hash("correct horse battery staple", { memoryKiB: 65_536, iterations: 3 });
verify("correct horse battery staple", stored); // true; throws an Argon2Error for a bad stored value
```

On Cloudflare Workers this needs a compatibility date of 2025-06-01 or later, or the `allow_eval_during_startup` flag.

## Documentation

- [Reference and design notes](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/docs/argon2.md) — every option and error code, the cost profiles, limits on verification, Workers requirements and the low-level entry.
- [Architecture](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/docs/ARCHITECTURE.md) — how the wasm is embedded and why.
- [Changelog](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/packages/argon2/CHANGELOG.md)
- [Contributing](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/CONTRIBUTING.md)

## License

[MIT](https://github.com/thomasfosterau/rust-wasm-packages/blob/trunk/packages/argon2/LICENSE)
