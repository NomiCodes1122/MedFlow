/**
 * Binary magic byte inspection to verify media authenticity and reject forged files
 * (e.g. executables or shell scripts disguised as images or audio files).
 */

export interface MagicByteValidationResult {
  isValid: boolean;
  detectedMimeType?: string;
  errorMessage?: string;
}

export class MediaValidator {
  /**
   * Validates that the buffer's binary header matches the claimed MIME type
   * and contains no executable / malicious signatures.
   */
  static validateMagicBytes(
    buffer: Buffer,
    claimedMimeType: string
  ): MagicByteValidationResult {
    if (!buffer || buffer.length < 4) {
      return {
        isValid: false,
        errorMessage: 'File buffer is too small to contain valid media headers',
      };
    }

    // 1. Immediate rejection of dangerous executable signatures
    if (this.isExecutableOrScript(buffer)) {
      return {
        isValid: false,
        errorMessage: 'File contains executable or script signatures and is strictly rejected',
      };
    }

    const mime = claimedMimeType.toLowerCase().trim();

    // 2. Format-specific magic byte checks
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      // JPEG: FF D8 FF
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { isValid: true, detectedMimeType: 'image/jpeg' };
      }
      return {
        isValid: false,
        errorMessage: 'Invalid JPEG magic bytes. Expected FF D8 FF.',
      };
    }

    if (mime === 'image/png') {
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      const matches = pngHeader.every((byte, idx) => buffer[idx] === byte);
      if (matches) {
        return { isValid: true, detectedMimeType: 'image/png' };
      }
      return {
        isValid: false,
        errorMessage: 'Invalid PNG magic bytes header.',
      };
    }

    if (mime === 'image/webp') {
      // WebP: RIFF (bytes 0-3) + WEBP (bytes 8-11)
      if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      ) {
        return { isValid: true, detectedMimeType: 'image/webp' };
      }
      return {
        isValid: false,
        errorMessage: 'Invalid WebP header. Expected RIFF...WEBP.',
      };
    }

    if (
      mime === 'audio/m4a' ||
      mime === 'audio/mp4' ||
      mime === 'audio/x-m4a'
    ) {
      // ISO Base Media File Format: bytes 4-8 equal 'ftyp'
      if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
        const majorBrand = buffer.toString('ascii', 8, 12).trim();
        const validBrands = ['M4A', 'isom', 'mp41', 'mp42', 'dash', 'M4B', 'M4P'];
        if (validBrands.some((b) => majorBrand.startsWith(b))) {
          return { isValid: true, detectedMimeType: 'audio/m4a' };
        }
      }
      return {
        isValid: false,
        errorMessage: 'Invalid M4A/MP4 audio header. Expected ftyp container.',
      };
    }

    if (mime === 'audio/aac') {
      // AAC: ADTS header syncword 0xFFF (12 bits) => byte 0 = 0xFF, byte 1 = 0xF0..0xFF
      // or ADIF header ('ADIF')
      if (
        buffer[0] === 0xff &&
        (buffer[1] & 0xf0) === 0xf0
      ) {
        return { isValid: true, detectedMimeType: 'audio/aac' };
      }
      if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'ADIF') {
        return { isValid: true, detectedMimeType: 'audio/aac' };
      }
      return {
        isValid: false,
        errorMessage: 'Invalid AAC audio header. Expected ADTS or ADIF sync word.',
      };
    }

    return {
      isValid: false,
      errorMessage: `Unsupported MIME type validation: ${claimedMimeType}`,
    };
  }

  /**
   * Checks whether the buffer matches known executable, script, or shell headers.
   */
  private static isExecutableOrScript(buffer: Buffer): boolean {
    // DOS / Windows PE: 'MZ' (0x4D, 0x5A)
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
      return true;
    }

    // Linux ELF: 0x7F, 'E', 'L', 'F' (0x7F 0x45 0x4C 0x46)
    if (
      buffer[0] === 0x7f &&
      buffer[1] === 0x45 &&
      buffer[2] === 0x4c &&
      buffer[3] === 0x46
    ) {
      return true;
    }

    // Shell script shebang: '#!' (0x23, 0x21)
    if (buffer[0] === 0x23 && buffer[1] === 0x21) {
      return true;
    }

    // Script tags or PHP opening tag in first 100 bytes
    const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 128)).toLowerCase();
    if (
      preview.includes('<script') ||
      preview.includes('<?php') ||
      preview.includes('eval(')
    ) {
      return true;
    }

    return false;
  }
}
