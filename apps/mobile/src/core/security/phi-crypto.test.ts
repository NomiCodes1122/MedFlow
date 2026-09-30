import { describe, it, expect } from 'vitest';
import { PhiCryptoService } from './phi-crypto.service.js';

describe('Field-Level AES-256-GCM PHI Encryption Strategy', () => {
  const secretKey = 'device-hardware-master-secret-key-12345';
  const key = PhiCryptoService.deriveKey(secretKey);

  it('should encrypt and decrypt sensitive demographic and clinical PHI correctly', () => {
    const sensitiveName = 'Jane Doe (DOB: 1985-04-12, SSN: 000-11-2222)';
    const encrypted = PhiCryptoService.encrypt(sensitiveName, key);

    expect(encrypted).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(encrypted).not.toContain('Jane Doe');

    const decrypted = PhiCryptoService.decrypt(encrypted, key);
    expect(decrypted).toBe(sensitiveName);
  });

  it('should pass through legacy unencrypted text safely without crashing', () => {
    const plaintext = 'Plain unencrypted notes';
    expect(PhiCryptoService.decrypt(plaintext, key)).toBe(plaintext);
  });

  it('should reject tampered ciphertext with authentication tag failure', () => {
    const encrypted = PhiCryptoService.encrypt('Top Secret Clinical Note', key);
    const parts = encrypted.split(':');
    // Tamper with the ciphertext byte
    const tamperedCiphertext = parts[4].slice(0, -2) + (parts[4].endsWith('a') ? 'b' : 'a');
    const tampered = `enc:v1:${parts[2]}:${parts[3]}:${tamperedCiphertext}`;

    expect(() => PhiCryptoService.decrypt(tampered, key)).toThrow();
  });
});
