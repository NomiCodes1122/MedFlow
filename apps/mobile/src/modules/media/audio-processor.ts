import { createHash } from 'node:crypto';
import { AudioProcessingResult } from './media.types.js';

export const MIN_AUDIO_DURATION_SEC = 1;
export const MAX_AUDIO_DURATION_SEC = 120;
export const MAX_AUDIO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export class AudioProcessor {
  /**
   * Validates and processes a recorded voice memo:
   * 1. Validates format (AAC/M4A).
   * 2. Inspects binary atoms for actual embedded duration when available.
   * 3. Enforces duration limits (1 - 120 seconds).
   * 4. Enforces size limit (<= 2 MB).
   * 5. Computes SHA-256 integrity checksum.
   */
  static processAudio(
    uri: string,
    fileBuffer: Buffer | Uint8Array,
    durationSeconds: number,
    mimeType: string = 'audio/m4a'
  ): AudioProcessingResult {
    const buffer = Buffer.from(fileBuffer);

    // 1. File size validation
    if (buffer.length > MAX_AUDIO_SIZE_BYTES) {
      throw new Error(
        `Voice memo size (${(buffer.length / 1024 / 1024).toFixed(2)} MB) exceeds maximum permitted limit of 2 MB`
      );
    }

    if (buffer.length < 8) {
      throw new Error('Audio buffer is too small to contain valid audio headers');
    }

    // 2. MIME validation
    const normalizedMime = mimeType.toLowerCase().trim();
    const validMimes = ['audio/m4a', 'audio/aac', 'audio/mp4', 'audio/x-m4a'];
    if (!validMimes.includes(normalizedMime)) {
      throw new Error(
        `Unsupported audio format: ${mimeType}. Expected AAC or M4A container.`
      );
    }

    // 3. Inspect binary atoms to verify/extract embedded duration if present
    const parsedDuration = this.parseM4aDuration(buffer);
    const resolvedDuration = parsedDuration !== null ? parsedDuration : durationSeconds;

    // 4. Enforce duration limits
    if (resolvedDuration < MIN_AUDIO_DURATION_SEC || resolvedDuration > MAX_AUDIO_DURATION_SEC) {
      throw new Error(
        `Voice memo duration (${resolvedDuration}s) outside allowed range of ${MIN_AUDIO_DURATION_SEC} to ${MAX_AUDIO_DURATION_SEC} seconds`
      );
    }

    // 5. SHA-256 checksum
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');

    return {
      uri,
      mimeType: normalizedMime,
      durationSeconds: resolvedDuration,
      fileSizeBytes: buffer.length,
      checksumSha256,
      processedBuffer: buffer,
    };
  }

  /**
   * Parses embedded timescale and duration from MP4/M4A binary atoms (moov -> mvhd box).
   */
  public static parseM4aDuration(buffer: Buffer): number | null {
    if (buffer.length < 16) return null;

    let offset = 0;
    while (offset + 8 <= buffer.length) {
      const size = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (size < 8 || offset + size > buffer.length) break;

      if (type === 'moov') {
        let subOffset = offset + 8;
        const end = offset + size;
        while (subOffset + 8 <= end) {
          const subSize = buffer.readUInt32BE(subOffset);
          const subType = buffer.toString('ascii', subOffset + 4, subOffset + 8);
          if (subSize < 8 || subOffset + subSize > end) break;

          if (subType === 'mvhd') {
            const version = buffer[subOffset + 8];
            const timescaleOffset =
              version === 1
                ? subOffset + 8 + 4 + 8 + 8 // 64-bit timestamps
                : subOffset + 8 + 4 + 4 + 4; // 32-bit timestamps
            const durationOffset = timescaleOffset + 4;

            if (durationOffset + (version === 1 ? 8 : 4) <= subOffset + subSize) {
              const timescale = buffer.readUInt32BE(timescaleOffset);
              const duration =
                version === 1
                  ? Number(buffer.readBigUInt64BE(durationOffset))
                  : buffer.readUInt32BE(durationOffset);

              if (timescale > 0) {
                return Math.round((duration / timescale) * 10) / 10;
              }
            }
          }
          subOffset += subSize;
        }
      }
      offset += size;
    }

    return null;
  }
}
