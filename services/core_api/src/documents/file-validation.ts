import { Injectable } from '@nestjs/common';

/** What a patient may upload. Deliberately short. */
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** 15 MB. Large enough for a photographed A4 page, small enough to bound the damage. */
export const MAX_BYTES = 15 * 1024 * 1024;

export type ScanVerdict =
  { readonly clean: true } | { readonly clean: false; readonly reason: string };

/**
 * Malware scanning.
 *
 * Abstract because production uses ClamAV or an equivalent daemon, which cannot be a
 * dependency of the unit tests, and because a hospital may mandate a particular scanner.
 */
export abstract class MalwareScanner {
  abstract readonly kind: string;
  abstract scan(bytes: Buffer, declaredContentType: string): Promise<ScanVerdict>;
}

/**
 * Magic-byte signatures for the types we accept.
 *
 * The declared content type is attacker-controlled: a request can call a PDF a JPEG, or
 * an executable a PDF. Checking the bytes is what stops the store filling with files that
 * are not what the metadata says, and stops a viewer being handed something it will
 * happily execute.
 */
const SIGNATURES: Readonly<Record<AllowedContentType, readonly number[][]>> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
};

export function sniffMatches(bytes: Buffer, contentType: string): boolean {
  const signatures = SIGNATURES[contentType as AllowedContentType];
  if (!signatures) return false;
  return signatures.some((sig) => sig.every((byte, i) => bytes[i] === byte));
}

/**
 * Development scanner.
 *
 * Detects the EICAR test string, which is what an antivirus integration is supposed to be
 * smoke-tested with, and enforces the magic-byte check. It is NOT antivirus, and
 * `assertProductionAdapters` refuses it in production: a hospital accepting patient
 * uploads with no real scanner is a malware distribution point with a waiting room.
 */
@Injectable()
export class HeuristicMalwareScanner extends MalwareScanner {
  readonly kind = 'heuristic';

  private static readonly EICAR =
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

  async scan(bytes: Buffer, declaredContentType: string): Promise<ScanVerdict> {
    if (bytes.includes(Buffer.from(HeuristicMalwareScanner.EICAR, 'ascii'))) {
      return { clean: false, reason: 'EICAR_TEST_SIGNATURE' };
    }

    if (!sniffMatches(bytes, declaredContentType)) {
      return { clean: false, reason: 'CONTENT_TYPE_MISMATCH' };
    }

    // A PDF that carries JavaScript or an embedded launch action is not something a
    // prescription needs, and is a well-worn delivery route.
    if (declaredContentType === 'application/pdf') {
      const head = bytes.subarray(0, Math.min(bytes.byteLength, 512 * 1024)).toString('latin1');
      for (const marker of ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile']) {
        if (head.includes(marker)) {
          return { clean: false, reason: `PDF_ACTIVE_CONTENT_${marker.slice(1).toUpperCase()}` };
        }
      }
    }

    return { clean: true };
  }
}

/** Refuses everything. Used when no scanner is configured, so nothing is stored unscanned. */
@Injectable()
export class UnconfiguredMalwareScanner extends MalwareScanner {
  readonly kind = 'unconfigured';

  async scan(): Promise<ScanVerdict> {
    // Fails CLOSED. An unscanned upload accepted "just this once" is how a hospital
    // becomes a malware distribution point with a waiting room.
    return { clean: false, reason: 'NO_SCANNER_CONFIGURED' };
  }
}

export interface ValidationProblem {
  readonly reason: string;
  readonly detail: string;
}

/** Cheap checks before a byte is written anywhere. */
export function validateUpload(bytes: Buffer, contentType: string): ValidationProblem | null {
  if (bytes.byteLength === 0) {
    return { reason: 'EMPTY_FILE', detail: 'the file contained no data' };
  }
  if (bytes.byteLength > MAX_BYTES) {
    return {
      reason: 'FILE_TOO_LARGE',
      detail: `${bytes.byteLength} bytes exceeds the ${MAX_BYTES} byte limit`,
    };
  }
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return { reason: 'UNSUPPORTED_TYPE', detail: `${contentType} is not accepted` };
  }
  return null;
}
