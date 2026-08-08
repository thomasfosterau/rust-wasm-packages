---
"@thomasfosterau/argon2": patch
---

Fix the `verifyPassword` usage example in the README.

It showed positional arguments (`verifyPassword(phc, password)`), but the function takes a single object: `verifyPassword({ hash, password })`. Copying the old example silently returned `false` for a correct password — indeed `verifyPassword` never throws by design (so a legacy or corrupt stored hash fails verification rather than failing the request), which means a wrong argument shape looks exactly like a wrong password.

Documentation only; no change to the API or the compiled wasm.
