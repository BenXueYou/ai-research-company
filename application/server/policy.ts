import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(value))
    throw new Error('邮箱格式无效');
  const at = value.lastIndexOf('@');
  return value.slice(0, at) + '@' + value.slice(at + 1).toLowerCase();
}
export function validNewPassword(value: unknown): value is string {
  return typeof value === 'string' && [...value].length >= 12 && [...value].length <= 128;
}
export function temporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt-32768-8-3$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, digest] = stored.split('$');
  if (algorithm !== 'scrypt-32768-8-3' || !salt || !digest)
    return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
