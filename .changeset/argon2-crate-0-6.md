---
"@thomasfosterau/argon2": patch
---

Build on version 0.6 of the RustCrypto `argon2` crate (from 0.5.3).

Hashes are unchanged, byte for byte, and so are the results and error codes of `hash`, `verify`, `hashPassword` and `verifyPassword`.
