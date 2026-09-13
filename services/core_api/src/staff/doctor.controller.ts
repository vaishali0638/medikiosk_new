import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { DOCTOR_FACING_DRAFT_LABEL, PROVENANCE_LABELS } from '@medikiosk/terminology';
import { DomainError } from '../common/domain-error';
import { RateLimitService } from '../security/rate-limit.service';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { DocumentService } from '../documents/document.service';
import { ExtractionService } from '../documents/extraction.service';
import { SummaryService } from '../summary/summary.service';
import { FollowUpService } from '../followup/followup.service';
import { DoctorService } from './doctor.service';
import { DocumentLinkService } from './document-link.service';
import { EncounterAccessService } from './encounter-access.service';
import { ExportService } from './export.service';
import { StaffAuthGuard, type StaffRequest } from './staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';

const signInSchema = z.object({ credential: z.string().min(1).max(4096) });

const confirmSchema = z.object({
  /** The record as the clinician left it. Validated against the draft schema. */
  record: z.unknown(),
  /** Required to open a record outside the clinician's own department. */
  breakGlassReason: z.string().min(10).max(500).optional(),
});

@ApiTags('doctor')
@Controller('doctor')
export class DoctorController {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly doctors: DoctorService,
    private readonly access: EncounterAccessService,
    private readonly summaries: SummaryService,
    private readonly followUps: FollowUpService,
    private readonly documents: DocumentService,
    private readonly extractions: ExtractionService,
    private readonly links: DocumentLinkService,
    private readonly exports: ExportService,
    private readonly rateLimits: RateLimitService,
  ) {}

  @Post('session')
  @ApiOperation({
    summary:
      'Exchange a staff identity-provider credential for a session. MediKiosk never ' +
      'holds a staff password and cannot create an account.',
  })
  async signIn(@Req() req: CorrelatedRequest, @Body() body: unknown): Promise<unknown> {
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('NOT_AUTHENTICATED', req.correlationId, 'bad sign-in payload');
    }

    // Keyed on the credential rather than the IP: a hospital's staff all arrive from one
    // or two addresses, so limiting by address would throttle a whole department the
    // moment one person mistyped. Credential stuffing tries many credentials, which this
    // catches, while one person retrying their own login is barely counted.
    await this.rateLimits.consume('STAFF_SIGN_IN', parsed.data.credential);

    const result = await this.auth.signIn(parsed.data.credential, req.correlationId);
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      displayName: result.staff.displayName,
      role: result.staff.role,
    };
  }

  @Post('session/end')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'Revoke the current staff session.' })
  async signOut(@Req() req: StaffRequest): Promise<{ ended: true }> {
    const header = req.header('authorization') ?? '';
    await this.auth.signOut(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    return { ended: true };
  }

  @Get('worklist')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({
    summary:
      'Today’s patients for this clinician, scoped to their department in the query. ' +
      'Names masked; searchable by token or UHID only.',
  })
  async worklist(@Req() req: StaffRequest, @Query('search') search?: string): Promise<unknown> {
    if (req.staff.role !== 'CLINICIAN') {
      throw new DomainError('NOT_AUTHORISED', req.correlationId, 'not a clinical role');
    }
    return { entries: await this.doctors.worklist(req.staff, search) };
  }

  @Get('encounters/:encounterId')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({
    summary:
      'The case: draft, provenance labels, documents, extraction confidence and the ' +
      'follow-up delta. Every view is audited.',
  })
  async encounter(
    @Req() req: StaffRequest,
    @Param('encounterId', UuidParamPipe) encounterId: string,
    @Query('breakGlassReason') breakGlassReason?: string,
  ): Promise<unknown> {
    const visit = await this.access.require(
      req.staff,
      encounterId,
      req.correlationId,
      breakGlassReason,
    );
    await this.access.recordView(req.staff, encounterId, req.correlationId, 'case');

    const preCheckinId = visit.preCheckinId;
    const draft = preCheckinId ? await this.summaries.latestFor(preCheckinId) : null;
    const delta = preCheckinId ? await this.followUps.deltaFor(preCheckinId) : null;
    const documents = preCheckinId ? await this.documents.listForPreCheckin(preCheckinId) : [];

    // Confidence IS shown here, unlike on the kiosk. A clinician verifying an extraction
    // is exactly the person a confidence number helps; a patient is not.
    const extractions = [];
    for (const document of documents) {
      const extraction = await this.extractions.findForDocument(document.documentId);
      extractions.push({
        documentId: document.documentId,
        documentType: document.documentType,
        state: document.state,
        reviewState: extraction?.review_state ?? null,
        overallConfidence: extraction?.overall_confidence ?? null,
        // Every field carries its label. The clinician confirms them; nothing here is a
        // record until they do.
        fields: extraction?.fields ?? null,
        // A refused document is LISTED — the clinician should know the patient tried to
        // supply something — but gets no link, because there are no bytes behind it. An
        // earlier version issued one for every row, so the one document a clinician most
        // wanted to look at was the one whose link always failed.
        link:
          document.state === 'STORED'
            ? this.links.issue(document.documentId, req.staff.userId)
            : null,
      });
    }

    return {
      encounterId,
      verified: visit.verifiedAt !== null,
      verifiedAt: visit.verifiedAt,
      draft: draft
        ? {
            summaryId: draft.summaryId,
            banner: DOCTOR_FACING_DRAFT_LABEL,
            provenance: draft.label,
            generator: draft.generator,
            sections: draft.draft.sections,
            narrative: draft.draft.narrative,
          }
        : null,
      followUp: delta,
      documents: extractions,
      labels: PROVENANCE_LABELS,
    };
  }

  @Get('documents/:documentId/original')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', 'inline')
  @ApiOperation({
    summary:
      'An original document, addressed by a short-lived signed link. Not behind the ' +
      'session guard: a browser cannot put a bearer token on an <img> tag.',
  })
  async original(
    @Req() req: CorrelatedRequest,
    @Param('documentId', UuidParamPipe) documentId: string,
    @Res() res: Response,
    @Query('exp') exp?: string,
    @Query('sub') sub?: string,
    @Query('sig') sig?: string,
  ): Promise<void> {
    const valid =
      sub !== undefined &&
      sig !== undefined &&
      this.links.verify({
        documentId,
        staffUserId: sub,
        expiry: Number(exp),
        signature: sig,
      });

    if (!valid) {
      throw new DomainError('NOT_AUTHORISED', req.correlationId, 'bad or expired document link');
    }

    const { bytes, document } = await this.documents.readOriginal(documentId, req.correlationId);
    res.setHeader('Content-Type', document.content_type);
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.end(bytes);
  }

  @Post('encounters/:encounterId/confirm')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({
    summary:
      'The clinician confirms the record. Writes a new CLINICIAN-VERIFIED summary rather ' +
      'than overwriting the draft, so what they were shown survives.',
  })
  async confirm(
    @Req() req: StaffRequest,
    @Param('encounterId', UuidParamPipe) encounterId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad confirm payload');
    }

    const visit = await this.access.require(
      req.staff,
      encounterId,
      req.correlationId,
      parsed.data.breakGlassReason,
    );

    const result = await this.doctors.confirm({
      staff: req.staff,
      encounterId,
      preCheckinId: visit.preCheckinId,
      record: parsed.data.record,
      correlationId: req.correlationId,
    });

    return {
      summaryId: result.summaryId,
      verifiedAt: result.verifiedAt,
      provenance: PROVENANCE_LABELS.CLINICIAN_VERIFIED,
    };
  }

  @Post('encounters/:encounterId/export')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({
    summary:
      'Export the confirmed record to the EMR. Refuses an unconfirmed one; idempotent ' +
      'per encounter; an uncertain outcome is reconciled, never blindly retried.',
  })
  async exportRecord(
    @Req() req: StaffRequest,
    @Param('encounterId', UuidParamPipe) encounterId: string,
    @Query('breakGlassReason') breakGlassReason?: string,
  ): Promise<unknown> {
    await this.access.require(req.staff, encounterId, req.correlationId, breakGlassReason);
    return this.exports.exportEncounter({
      staff: req.staff,
      encounterId,
      correlationId: req.correlationId,
    });
  }
}
