import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { GOVERNANCE_STATES } from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { StaffAuthGuard, type StaffRequest } from '../staff/staff-auth.guard';
import { ReleaseService } from './release.service';
import { GovernanceQueryService } from './governance-query.service';

const draftSchema = z.object({
  contentKind: z.string().min(1).max(64),
  contentKey: z.string().min(1).max(200),
  semver: z.string().min(1).max(64),
  payload: z.unknown(),
});

const transitionSchema = z.object({
  to: z.enum(GOVERNANCE_STATES),
  note: z.string().max(1000).optional(),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
  canaryKioskCodes: z.array(z.string().min(1).max(64)).max(50).optional(),
  rollbackReason: z.string().min(10).max(1000).optional(),
});

@ApiTags('governance')
@Controller('governance')
@UseGuards(StaffAuthGuard)
export class GovernanceController {
  constructor(
    private readonly releases: ReleaseService,
    private readonly queries: GovernanceQueryService,
  ) {}

  @Get('releases')
  @ApiOperation({ summary: 'Releases for this hospital, newest first.' })
  async list(@Req() req: StaffRequest, @Query('contentKey') contentKey?: string): Promise<unknown> {
    this.requireReviewer(req);
    return { releases: await this.queries.list(req.staff.hospitalId, contentKey) };
  }

  @Post('releases')
  @ApiOperation({
    summary:
      'Create a draft. Content is schema-validated here, at authoring, rather than three ' +
      'reviews later.',
  })
  async createDraft(@Req() req: StaffRequest, @Body() body: unknown): Promise<unknown> {
    this.requireReviewer(req);
    const parsed = draftSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad draft payload');
    }

    const row = await this.releases.createDraft({
      hospitalId: req.staff.hospitalId,
      contentKind: parsed.data.contentKind,
      contentKey: parsed.data.contentKey,
      semver: parsed.data.semver,
      payload: parsed.data.payload,
      correlationId: req.correlationId,
      actor: req.staff,
    });

    return { releaseId: row.id, state: row.state };
  }

  @Post('releases/:releaseId/approvals')
  @ApiOperation({
    summary: 'Record one named approval. Approvals accumulate and are never replaced wholesale.',
  })
  async approve(
    @Req() req: StaffRequest,
    @Param('releaseId', UuidParamPipe) releaseId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    this.requireReviewer(req);
    const row = await this.releases.approve({
      versionId: releaseId,
      approval: body,
      actor: req.staff,
      correlationId: req.correlationId,
    });
    return { releaseId: row.id, approvals: row.approvals };
  }

  @Post('releases/:releaseId/transition')
  @ApiOperation({
    summary:
      'Move a release along. The approval gate is checked on the IN_REVIEW → APPROVED ' +
      'edge; everything downstream is unreachable without it.',
  })
  async transition(
    @Req() req: StaffRequest,
    @Param('releaseId', UuidParamPipe) releaseId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad transition payload');
    }

    const row = await this.releases.transition({
      versionId: releaseId,
      to: parsed.data.to,
      actor: req.staff,
      correlationId: req.correlationId,
      note: parsed.data.note,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : undefined,
      canaryKioskCodes: parsed.data.canaryKioskCodes,
      rollbackReason: parsed.data.rollbackReason,
    });

    return {
      releaseId: row.id,
      state: row.state,
      publishedAt: row.published_at,
      canaryKioskCodes: row.canary_kiosk_codes,
    };
  }

  @Get('releases/:releaseId/history')
  @ApiOperation({ summary: 'Every state change this release went through, in order.' })
  async history(
    @Req() req: StaffRequest,
    @Param('releaseId', UuidParamPipe) releaseId: string,
  ): Promise<unknown> {
    this.requireReviewer(req);
    return { transitions: await this.releases.history(releaseId) };
  }

  @Get('unversioned')
  @ApiOperation({
    summary:
      'Content kinds a hospital is serving with nothing published. The exit criterion ' +
      '"no live content lacks a version", as a query rather than a promise.',
  })
  async unversioned(@Req() req: StaffRequest): Promise<unknown> {
    this.requireReviewer(req);
    return { missing: await this.queries.missingPublishedContent(req.staff.hospitalId) };
  }

  private requireReviewer(req: StaffRequest): void {
    if (req.staff.role !== 'GOVERNANCE_REVIEWER') {
      throw new DomainError(
        'NOT_AUTHORISED',
        req.correlationId,
        `role ${req.staff.role} is not a governance reviewer`,
      );
    }
  }
}
