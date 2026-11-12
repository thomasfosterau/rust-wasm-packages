/**
 * Known hashes that pin this package's output.
 *
 * @module tests/fixtures/hashes
 */

/** The salt every fixture below was produced with: bytes 1 to 16. */
export const FIXED_SALT = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

/**
 * What the published `@thomasfosterau/argon2@0.1.1` tarball's `hashPassword`
 * returned with `crypto.getRandomValues` stubbed to {@link FIXED_SALT}.
 * `hashPassword` must keep producing these byte for byte, and
 * `verifyPassword` must keep accepting them.
 */
export const PUBLISHED_0_1_1 = [
  {
    password: "correct horse battery staple",
    hash: "$argon2id$v=19$m=19456,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$u7HkQc8NFEyI1fGa9gfr7DIUnvi/UM/saRdXcmsbkMA",
  },
  {
    password: "",
    hash: "$argon2id$v=19$m=19456,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$mRf6deiDoBtn9B/VLhIrDbaYU2F3hHKIKTZb6kGw0zw",
  },
  {
    password: "🔐 pässwörd 密码",
    hash: "$argon2id$v=19$m=19456,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$2lasqz5HbqgDVvQcs3Ww6u98aL8vrFw3zhLINflMOj8",
  },
  {
    password: "a".repeat(200),
    hash: "$argon2id$v=19$m=19456,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$aGV+0hRWJA+zoHdfz3/QwE0YsiRclg4JAUasBKbYOic",
  },
] as const;

/**
 * Hashes of `"correct horse battery staple"` from the reference C
 * implementation (libargon2, through Python's `argon2-cffi`), one per variant
 * and at the edges of the digest and salt lengths. They are independent of the
 * RustCrypto crate this package compiles, so they catch a wrong variant
 * number or a misplaced parameter that a round trip would not.
 */
export const REFERENCE = [
  {
    options: {
      variant: "argon2id",
      memoryKiB: 64,
      iterations: 3,
      parallelism: 4,
      salt: FIXED_SALT,
    },
    hash: "$argon2id$v=19$m=64,t=3,p=4$AQIDBAUGBwgJCgsMDQ4PEA$ZYiQrfQ1iM19UHMw4GNrPHbDR6LSr06i98U+YtUCDhA",
  },
  {
    options: {
      variant: "argon2i",
      memoryKiB: 64,
      iterations: 2,
      parallelism: 1,
      hashLength: 24,
      salt: FIXED_SALT,
    },
    hash: "$argon2i$v=19$m=64,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$WAlJgs8O0huU4Yh8U6mlQdM4lpCYh/cB",
  },
  {
    options: {
      variant: "argon2d",
      memoryKiB: 32,
      iterations: 3,
      parallelism: 2,
      hashLength: 64,
      salt: FIXED_SALT,
    },
    hash: "$argon2d$v=19$m=32,t=3,p=2$AQIDBAUGBwgJCgsMDQ4PEA$nf+Y78TUhLG7XdyB++iTifiDzY6A9c4Xailk0aQnVYvwj40dQfGPUwNVeaOh4awrT7H/pjdEMuFKgLeIIez/CQ",
  },
  {
    options: {
      variant: "argon2id",
      memoryKiB: 8,
      iterations: 1,
      parallelism: 1,
      hashLength: 10,
      salt: new TextEncoder().encode("saltsalt"),
    },
    hash: "$argon2id$v=19$m=8,t=1,p=1$c2FsdHNhbHQ$VqrMucHSaicVwQ",
  },
] as const;

/**
 * The same password from the reference implementation at argon2 version 16
 * (0x10), which this package verifies but never writes. The argon2 encoding
 * omits the version field only for this version.
 */
export const VERSION_16 =
  "$argon2id$v=16$m=64,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$2gQKLCzeZ1lDz187W7kYFwFZfcw9eNts8Z+k4ZwSCdU";
