import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/** Two minutes: long enough to click, short enough that a copied link is dead. */
const LINK_TTL_SECONDS = 120;

/**
 * Short-lived signed links to original documents.
 *
 * The specification asks for these, and the reason is specific: a clinician's browser
 * renders a prescription image, and an `<img>` tag cannot carry an Authorization header.
 * The alternatives are a cookie that then authorises every request the page makes, or a
 * URL that is itself the credential. This is the second, made safe by being useless within
 * two minutes.
 *
 * The signature binds the document id AND the staff user, so a link pasted into a chat
 * does not work for the person who receives it even inside the expiry window.
 */
@Injectable()
export class DocumentLinkService {
  private readonly logger = new Logger(DocumentLinkService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const configured = config.get('DOCUMENT_LINK_KEY', { infer: true });
    if (configured) {
      this.key = Buffer.from(configured, 'utf8');
    } else {
      // Ephemeral, and said out loud. Links stop working after a restart, which is a
      // visible nuisance rather than a silent weakening.
      this.key = randomBytes(32);
      this.logger.warn(
        'DOCUMENT_LINK_KEY is not set. Generated an ephemeral key — document links issued ' +
          'before a restart will stop working afterwards.',
      );
    }
  }

  issue(documentId: string, staffUserId: string): { url: string; expiresAt: Date } {
    const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000);
    const expiry = Math.floor(expiresAt.getTime() / 1000);
    const signature = this.sign(documentId, staffUserId, expiry);

    return {
      url: `/v1/doctor/documents/${documentId}/original?exp=${expiry}&sub=${staffUserId}&sig=${signature}`,
      expiresAt,
    };
  }

  /** True when the signature is intact, matches this user, and has not expired. */
  verify(input: {
    documentId: string;
    staffUserId: string;
    expiry: number;
    signature: string;
  }): boolean {
    if (!Number.isFinite(input.expiry) || input.expiry * 1000 <= Date.now()) return false;

    const expected = this.sign(input.documentId, input.staffUserId, input.expiry);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(input.signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(documentId: string, staffUserId: string, expiry: number): string {
    return createHmac('sha256', this.key)
      .update(`${documentId}.${staffUserId}.${expiry}`)
      .digest('base64url');
  }
}
