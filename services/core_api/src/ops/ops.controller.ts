import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { TokenService } from '../arrival/token.service';
import { OpsGuard } from './ops.guard';

/**
 * The reconciliation dashboard's backing endpoints.
 *
 * Deliberately narrow: it lists token requests whose outcome is unknown and re-polls the
 * HIS about them. It exposes no patient data and offers no way to mint a token — the only
 * resolution available here is to ask the hospital what it already did.
 */
@ApiTags('ops')
@Controller('ops')
@UseGuards(OpsGuard)
export class OpsController {
  constructor(private readonly tokens: TokenService) {}

  @Get('reconciliation')
  @ApiOperation({ summary: 'Token requests awaiting human reconciliation, oldest first.' })
  async list(): Promise<{ items: unknown[]; count: number }> {
    const items = await this.tokens.listReconciliation();
    return { items, count: items.length };
  }

  @Post('reconciliation/sweep')
  @ApiOperation({
    summary:
      'Re-poll the HIS for every unresolved request. Only ever asks; never requests a ' +
      'token, so it is safe to run as often as needed.',
  })
  async sweep(@Req() req: CorrelatedRequest): Promise<{ resolved: number; pending: number }> {
    return this.tokens.sweepReconciliation(req.correlationId);
  }
}
