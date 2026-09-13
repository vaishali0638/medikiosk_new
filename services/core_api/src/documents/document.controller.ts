import { Body, Controller, Get, Header, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { DOCUMENT_TYPES } from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { PreCheckinService } from '../precheckin/precheckin.service';
import { DocumentService } from './document.service';
import { ExtractionService } from './extraction.service';
import { ALLOWED_CONTENT_TYPES, MAX_BYTES } from './file-validation';

/**
 * An upload, as base64.
 *
 * Not multipart: the payloads are small (a phone photo of an A4 page), and a single JSON
 * body keeps the request shape identical to every other endpoint — one parser, one
 * validation path, one place where size limits are enforced.
 */
const uploadSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  /** Base64. Bounded generously above MAX_BYTES so oversized files are refused by us,
   *  with a reason, rather than by the JSON parser with a 413. */
  data: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_BYTES * 1.4)),
  originalFilename: z.string().max(255).optional(),
  documentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

@ApiTags('documents')
@Controller()
@UseGuards(KioskDeviceGuard)
export class DocumentController {
  constructor(
    private readonly documents: DocumentService,
    private readonly extractions: ExtractionService,
    private readonly preCheckins: PreCheckinService,
  ) {}

  @Post('precheckins/:preCheckinId/documents')
  @ApiOperation({
    summary:
      'Upload an original document. Scanned, encrypted and stored; extraction is queued ' +
      'and never blocks the visit.',
  })
  async upload(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad upload payload');
    }

    const preCheckin = await this.preCheckins.findById(preCheckinId);
    if (!preCheckin || preCheckin.hospital_id !== req.kiosk.hospitalId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'unknown pre-check-in');
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(parsed.data.data, 'base64');
    } catch {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'payload is not base64');
    }

    const document = await this.documents.upload({
      preCheckinId,
      patientId: preCheckin.patient_id,
      documentType: parsed.data.documentType,
      contentType: parsed.data.contentType,
      bytes,
      originalFilename: parsed.data.originalFilename,
      documentDate: parsed.data.documentDate,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    });

    return {
      documentId: document.id,
      state: document.state,
      sha256: document.sha256,
      // The doctor will see a label, not a reading. Said here so a client cannot present
      // a queued extraction as a completed one.
      extraction: 'QUEUED',
    };
  }

  @Get('precheckins/:preCheckinId/documents')
  @ApiOperation({ summary: 'Documents attached to a visit, with their extraction state.' })
  async list(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
  ): Promise<{ documents: unknown[] }> {
    const preCheckin = await this.preCheckins.findById(preCheckinId);
    if (!preCheckin || preCheckin.hospital_id !== req.kiosk.hospitalId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'unknown pre-check-in');
    }
    return { documents: await this.documents.listForPreCheckin(preCheckinId) };
  }

  @Get('documents/:documentId/original')
  @Header('Cache-Control', 'no-store')
  // The browser must not be invited to guess: a document served as its declared type and
  // never inline is what stops a crafted upload executing in a viewer's context.
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', 'attachment')
  @ApiOperation({ summary: 'The original bytes, integrity-checked on the way out.' })
  async original(
    @Req() req: KioskRequest,
    @Param('documentId', UuidParamPipe) documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, document } = await this.documents.readOriginal(documentId, req.correlationId);

    res.setHeader('Content-Type', document.content_type);
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.end(bytes);
  }

  @Get('documents/:documentId/extraction')
  @ApiOperation({
    summary:
      'The extraction candidate for a document. Candidates only — nothing here is a ' +
      'clinical record until a clinician confirms it.',
  })
  async extraction(
    @Req() req: KioskRequest,
    @Param('documentId', UuidParamPipe) documentId: string,
  ): Promise<unknown> {
    const extraction = await this.extractions.findForDocument(documentId);
    if (!extraction) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'no extraction for document');
    }

    return {
      documentId,
      reviewState: extraction.review_state,
      extractorVersion: extraction.extractor_version,
      overallConfidence: extraction.overall_confidence,
      fields: extraction.fields,
      lastErrorCode: extraction.last_error_code,
      attempts: extraction.attempt_count,
    };
  }
}
