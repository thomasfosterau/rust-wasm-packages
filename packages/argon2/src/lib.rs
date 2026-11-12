//! argon2id password hashing for the Cloudflare Workers runtime.
//!
//! A thin wrapper over the RustCrypto `argon2` crate, compiled to
//! `wasm32-unknown-unknown`. Two properties of that target are the whole point
//! of building this in-repo rather than consuming `@node-rs/argon2`:
//!
//! * **No WASI.** `@node-rs/argon2`'s only Workers-viable artifact is a
//!   `wasm32-wasi` build whose loader reaches for `node:fs` / `node:wasi` /
//!   `node:worker_threads`, none of which exist under `nodejs_compat`.
//!   `wasm32-unknown-unknown` has no syscall surface to shim.
//! * **No async task pool.** napi-rs spawns a `Worker` for its async exports on
//!   first use, which workerd cannot do. There is nothing here but exported
//!   functions running on the calling thread.
//!
//! ## ABI
//!
//! Linear memory is managed explicitly by the caller: [`alloc`] a buffer, write
//! into it, call, then [`dealloc`]. Strings cross the boundary as UTF-8 bytes.
//! Every entry point is pure computation over caller-supplied bytes.
//!
//! [`hash`] and [`verify`] are the original entry points and are frozen: they
//! are argon2id-only with a 32-byte digest, and `verify` folds every failure
//! into `-1`. [`hash_with`] and [`verify_with`] add the algorithm variant, the
//! digest length, caller-set limits on verification and distinct error codes.
//!
//! **The salt is supplied by the caller**, not generated here. That keeps
//! `getrandom` (and therefore any syscall dependency) out of the build
//! entirely; the JS side uses Web Crypto, which is a better entropy source on
//! this runtime anyway.

use argon2::{Algorithm, Argon2, Params, Version};
use argon2::password_hash::{self, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use core::slice;

/// Reserve `len` bytes of linear memory and hand the caller the pointer.
///
/// # Safety
/// The caller must eventually pass the returned pointer and the same `len` to
/// [`dealloc`], and must not read or write outside `[ptr, ptr + len)`.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// Release a buffer previously returned by [`alloc`].
///
/// # Safety
/// `ptr` must come from [`alloc`] and `len` must be the same length passed to
/// it. The buffer must not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len != 0 {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

/// The last result's length in bytes, or a negative error code.
///
/// The wasm ABI can only return one scalar, so the pointer to a produced string
/// is fetched separately via [`last_ptr`]. Single-threaded by construction —
/// there is exactly one calling thread on this runtime.
static mut LAST: Option<Vec<u8>> = None;

/// Pointer to the bytes produced by the most recent [`hash`] or [`hash_with`]
/// call.
#[no_mangle]
pub extern "C" fn last_ptr() -> *const u8 {
    // SAFETY: single-threaded runtime; `LAST` is only written by the hash
    // entry points.
    unsafe {
        match &*core::ptr::addr_of!(LAST) {
            Some(v) => v.as_ptr(),
            None => core::ptr::null(),
        }
    }
}

fn build(m_cost: u32, t_cost: u32, p_cost: u32) -> Option<Argon2<'static>> {
    let params = Params::new(m_cost, t_cost, p_cost, None).ok()?;
    Some(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

/// Hash `password` with `salt` at the given argon2id cost parameters.
///
/// Writes a PHC string (`$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`) into
/// module memory and returns its length; the caller reads it from [`last_ptr`].
/// Returns `-1` on any failure (bad parameters, unencodable salt, hash error).
///
/// # Safety
/// `password_ptr` / `salt_ptr` must point at initialised buffers of the given
/// lengths.
#[no_mangle]
pub unsafe extern "C" fn hash(
    password_ptr: *const u8,
    password_len: usize,
    salt_ptr: *const u8,
    salt_len: usize,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> i32 {
    let password = slice::from_raw_parts(password_ptr, password_len);
    let salt_bytes = slice::from_raw_parts(salt_ptr, salt_len);

    let Some(argon2) = build(m_cost, t_cost, p_cost) else {
        return -1;
    };
    // The PHC format carries the salt B64-encoded; `SaltString` enforces the
    // spec's length bounds, so an out-of-range salt is rejected here rather
    // than producing an unparseable hash.
    let Ok(salt) = SaltString::encode_b64(salt_bytes) else {
        return -1;
    };
    let Ok(phc) = argon2.hash_password(password, &salt) else {
        return -1;
    };

    let bytes = phc.to_string().into_bytes();
    let len = bytes.len() as i32;
    LAST = Some(bytes);
    len
}

/// Verify `password` against a stored PHC string.
///
/// Returns `1` on a match, `0` on a mismatch, and `-1` when `stored` is not a
/// parseable PHC string. Callers should treat `-1` as a failed verification —
/// a foreign or corrupt stored value must not be an exception.
///
/// # Safety
/// Both pointers must reference initialised buffers of the given lengths.
#[no_mangle]
pub unsafe extern "C" fn verify(
    password_ptr: *const u8,
    password_len: usize,
    stored_ptr: *const u8,
    stored_len: usize,
) -> i32 {
    let password = slice::from_raw_parts(password_ptr, password_len);
    let stored = slice::from_raw_parts(stored_ptr, stored_len);

    let Ok(stored) = core::str::from_utf8(stored) else {
        return -1;
    };
    let Ok(parsed) = PasswordHash::new(stored) else {
        return -1;
    };
    // Cost parameters come from the stored hash, not from the caller, so a hash
    // written at older parameters keeps verifying after a cost bump.
    match Argon2::default().verify_password(password, &parsed) {
        Ok(()) => 1,
        Err(password_hash::Error::Password) => 0,
        Err(_) => -1,
    }
}

/// `hash_with`: the parameters are not valid for argon2.
/// `verify_with`: the stored value is not a PHC string with a salt and digest.
const ERR_INVALID: i32 = -1;
/// `hash_with`: the salt cannot be encoded into a PHC string.
/// `verify_with`: the stored value is a PHC string, but not an argon2 hash
/// this module will verify.
const ERR_UNSUPPORTED: i32 = -2;
/// The computation itself failed.
const ERR_INTERNAL: i32 = -3;

/// `0` = argon2d, `1` = argon2i, `2` = argon2id — the numbering of the argon2
/// specification's `y` parameter.
fn algorithm(id: u32) -> Option<Algorithm> {
    match id {
        0 => Some(Algorithm::Argon2d),
        1 => Some(Algorithm::Argon2i),
        2 => Some(Algorithm::Argon2id),
        _ => None,
    }
}

/// Hash `password` with `salt`, choosing the variant, the cost parameters and
/// the digest length.
///
/// Writes a PHC string into module memory and returns its length; the caller
/// reads it from [`last_ptr`]. Returns `-1` when the variant, costs or digest
/// length are not valid argon2 parameters, `-2` when the salt cannot be
/// encoded, and `-3` when hashing itself fails.
///
/// # Safety
/// `password_ptr` / `salt_ptr` must point at initialised buffers of the given
/// lengths.
#[no_mangle]
pub unsafe extern "C" fn hash_with(
    password_ptr: *const u8,
    password_len: usize,
    salt_ptr: *const u8,
    salt_len: usize,
    algorithm_id: u32,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
    output_len: usize,
) -> i32 {
    let password = slice::from_raw_parts(password_ptr, password_len);
    let salt_bytes = slice::from_raw_parts(salt_ptr, salt_len);

    let Some(algorithm) = algorithm(algorithm_id) else {
        return ERR_INVALID;
    };
    let Ok(params) = Params::new(m_cost, t_cost, p_cost, Some(output_len)) else {
        return ERR_INVALID;
    };
    let Ok(salt) = SaltString::encode_b64(salt_bytes) else {
        return ERR_UNSUPPORTED;
    };
    let argon2 = Argon2::new(algorithm, Version::V0x13, params);
    let Ok(phc) = argon2.hash_password(password, &salt) else {
        return ERR_INTERNAL;
    };

    let bytes = phc.to_string().into_bytes();
    let len = bytes.len() as i32;
    LAST = Some(bytes);
    len
}

/// Verify `password` against a stored PHC string, refusing hashes whose cost
/// parameters exceed the caller's limits.
///
/// Returns `1` on a match and `0` on a mismatch. Returns `-1` when `stored` is
/// not a PHC string carrying both a salt and a digest, and `-2` when it is one
/// but is not an argon2 hash this module will verify: an unknown algorithm or
/// version, invalid parameters, or a memory, iteration or parallelism cost
/// above `max_m_cost` / `max_t_cost` / `max_p_cost`. The limits are checked
/// before any memory is reserved, so a hostile stored value cannot make
/// verification expensive. Returns `-3` when the computation itself fails.
///
/// # Safety
/// Both pointers must reference initialised buffers of the given lengths.
#[no_mangle]
pub unsafe extern "C" fn verify_with(
    password_ptr: *const u8,
    password_len: usize,
    stored_ptr: *const u8,
    stored_len: usize,
    max_m_cost: u32,
    max_t_cost: u32,
    max_p_cost: u32,
) -> i32 {
    let password = slice::from_raw_parts(password_ptr, password_len);
    let stored = slice::from_raw_parts(stored_ptr, stored_len);

    let Ok(stored) = core::str::from_utf8(stored) else {
        return ERR_INVALID;
    };
    let Ok(parsed) = PasswordHash::new(stored) else {
        return ERR_INVALID;
    };
    let (Some(salt), Some(expected)) = (parsed.salt, parsed.hash) else {
        return ERR_INVALID;
    };

    let Ok(algorithm) = Algorithm::try_from(parsed.algorithm) else {
        return ERR_UNSUPPORTED;
    };
    let version = match parsed.version {
        Some(version) => match Version::try_from(version) {
            Ok(version) => version,
            Err(_) => return ERR_UNSUPPORTED,
        },
        // The argon2 encoding leaves the version out only for 0x10, the
        // version that predates the field.
        None => Version::V0x10,
    };
    let Ok(params) = Params::try_from(&parsed) else {
        return ERR_UNSUPPORTED;
    };
    if params.m_cost() > max_m_cost || params.t_cost() > max_t_cost || params.p_cost() > max_p_cost
    {
        return ERR_UNSUPPORTED;
    }

    // Hashed and compared here rather than through `verify_password`, which
    // ignores this `Argon2`'s version and reads a versionless hash as 0x13.
    // `Output`'s equality is constant-time.
    match Argon2::new(algorithm, version, params).hash_password(password, salt) {
        Ok(computed) => i32::from(computed.hash == Some(expected)),
        Err(password_hash::Error::Crypto) => ERR_INTERNAL,
        // What is left is the algorithm rejecting its input (a salt shorter
        // than argon2 allows, say): the stored value's fault, not ours.
        Err(_) => ERR_UNSUPPORTED,
    }
}
