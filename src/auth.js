import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

/** Hash a password with scrypt and a random salt. Format: scrypt$<salt>$<hash>. */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const [, salt, expected] = stored.split('$');
  const hash = await scryptAsync(password, salt, KEY_LEN);
  const want = Buffer.from(expected, 'base64url');
  return want.length === hash.length && timingSafeEqual(hash, want);
}

// Used when the email doesn't exist, so a failed login takes as long either way
// and response timing doesn't reveal which emails have accounts.
export const DUMMY_HASH = await hashPassword('not-a-real-password');

export const COOKIE = 'sd_session';

export function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(req, value, maxAgeSeconds) {
  const secure = req.secure ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function validateCredentials(body = {}) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const errors = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.push('enter a valid email address');
  if (password.length < 8) errors.push('password must be at least 8 characters');
  if (password.length > 200) errors.push('password must be at most 200 characters');
  return { email, password, errors };
}
