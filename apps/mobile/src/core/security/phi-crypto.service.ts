import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export class PhiCryptoService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // 96-bit IV recommended for GCM
  private static readonly TAG_LENGTH = 16;
  private static readonly SALT = 'medflow-phi-salt-v1';

  /**
   * Derives a 256-bit AES key from a secret string using scrypt.
   */
  static deriveKey(secret: string): Buffer {
    return scryptSync(secret, this.SALT, 32);
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Returns formatted ciphertext: `enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
   */
  static encrypt(plaintext: string, key: Buffer): string {
    const iv = randomBytes(this.IV_LENGTH);
    const cipher = createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts ciphertext formatted as `enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`.
   * If the input is not encrypted (e.g. unencrypted legacy or plaintext), returns original string.
   */
  static decrypt(ciphertext: string, key: Buffer): string {
    if (!ciphertext.startsWith('enc:v1:')) {
      return ciphertext;
    }

    const parts = ciphertext.split(':');
    if (parts.length !== 5) {
      throw new Error('Malformed PHI ciphertext envelope');
    }

    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const encryptedText = parts[4];

    const decipher = createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
