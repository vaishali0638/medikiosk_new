import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPreCheckinRequestSchema,
  type IssueQrResponse,
  type PreCheckin,
} from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import type { PreCheckinRow } from '../db/database.types';
import { PreCheckinService } from './precheckin.service';

/**
 * Patient-facing pre-check-in, called from the mobile PWA.
 *
 * Deliberately not behind the kiosk device guard: this runs on the patient's own phone,
 * from outside the hospital. Authorisation comes from holding a consent id issued to
 * them, and every endpoint re-checks that the consent is live.
 */
@ApiTags('precheckin')
@Controller('precheckins')
export class PreCheckinController {
  constructor(private readonly preCheckins: PreCheckinService) {}

  @Post()
  @ApiOperation({ summary: 'Create a pre-check-in against an existing consent.' })
  async create(@Req() req: CorrelatedRequest, @Body() body: unknown): Promise<PreCheckin> {
    const parsed = createPreCheckinRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad pre-check-in payload');
    }

    const row = await this.preCheckins.create(parsed.data, {
      correlationId: req.correlationId,
      actorId: 'patient:pwa',
    });
    return this.toResponse(row, parsed.data.visit);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit a reviewed intake. Only a submitted intake gets a QR.' })
  async submit(@Req() req: CorrelatedRequest, @Param('id') id: string): Promise<{ state: string }> {
    const row = await this.preCheckins.submit(id, {
      correlationId: req.correlationId,
      actorId: 'patient:pwa',
    });
    return { state: row.state };
  }

  @Post(':id/qr')
  @ApiOperation({
    summary: 'Issue a signed, short-lived, single-use QR. Carries no medical data.',
  })
  async issueQr(@Req() req: CorrelatedRequest, @Param('id') id: string): Promise<IssueQrResponse> {
    const signed = await this.preCheckins.issueQr(id, {
      correlationId: req.correlationId,
      actorId: 'patient:pwa',
    });

    return {
      preCheckinId: id,
      payload: signed.token,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  private toResponse(row: PreCheckinRow, visit: PreCheckin['visit']): PreCheckin {
    return {
      preCheckinId: row.id,
      patientId: row.patient_id,
      consentId: row.consent_id,
      visit,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      ...(row.submitted_at ? { submittedAt: row.submitted_at.toISOString() } : {}),
    };
  }
}
