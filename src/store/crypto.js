import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

/**
 * AES-256-GCM for the Campus Connect session cookie at rest.
 *
 * It's a live credential for the student's account, so it never touches the
 * database in plaintext. GCM is authenticated, so a tampered record fails
 * loudly instead of silently decrypting to garbage.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function loadKey(hexKey) {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey ?? '')) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== KEY_BYTES) throw new Error('SESSION_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function createCryptoBox(hexKey) {
  const key = loadKey(hexKey);

  return {
    /** @returns {{iv: string, tag: string, data: string}} */
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      };
    },

    decrypt(record) {
      if (!record?.iv || !record?.tag || !record?.data) {
        throw new Error('Malformed encrypted record');
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      const out = Buffer.concat([
        decipher.update(Buffer.from(record.data, 'base64')),
        decipher.final(),
      ]);
      return out.toString('utf8');
    },
  };
}

export { randomUUID };
