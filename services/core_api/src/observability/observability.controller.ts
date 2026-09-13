import { Body, Controller, Get, Header, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { DomainError } from '../common/domain-error';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { OpsGuard } from '../ops/ops.guard';
import { AlertsService } from './alerts.service';
import { DEVICE_EVENT_KINDS, DeviceEventsService } from './device-events.service';
import { MetricsService, renderPrometheus } from './metrics.service';

const deviceEventSchema = z.object({
  kind: z.enum(DEVICE_EVENT_KINDS),
  /** Operational detail only. Redacted before storage regardless. */
  detail: z.record(z.unknown()).optional(),
  sessionId: z.string().uuid().optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

@ApiTags('observability')
@Controller()
export class ObservabilityController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
    private readonly deviceEvents: DeviceEventsService,
  ) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @UseGuards(OpsGuard)
  @ApiOperation({
    summary:
      'Prometheus metrics. Counts and rates only — never a patient id, a number or any ' +
      'clinical text.',
  })
  async prometheus(): Promise<string> {
    return renderPrometheus(await this.metrics.collect());
  }

  @Get('ops/alerts')
  @UseGuards(OpsGuard)
  @ApiOperation({
    summary: 'Alerts currently firing, each naming the runbook that says what to do.',
  })
  async firing(): Promise<unknown> {
    const alerts = await this.alerts.evaluate();
    return {
      firing: alerts.length,
      critical: alerts.filter((a) => a.severity === 'CRITICAL').length,
      alerts,
    };
  }

  @Get('ops/device-events')
  @UseGuards(OpsGuard)
  @ApiOperation({ summary: 'Recent device-reported faults, newest first.' })
  async events(): Promise<unknown> {
    return { events: await this.deviceEvents.recent() };
  }

  @Post('kiosk/events')
  @UseGuards(KioskDeviceGuard)
  @ApiOperation({
    summary:
      'A kiosk reports something only it knows: a crash, a lost network, a printer out ' +
      'of paper.',
  })
  async report(@Req() req: KioskRequest, @Body() body: unknown): Promise<{ recorded: true }> {
    const parsed = deviceEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad device event');
    }

    await this.deviceEvents.record({
      kioskDeviceId: req.kiosk.deviceId,
      kind: parsed.data.kind,
      detail: parsed.data.detail,
      kioskSessionId: parsed.data.sessionId,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
      correlationId: req.correlationId,
    });

    return { recorded: true };
  }
}
