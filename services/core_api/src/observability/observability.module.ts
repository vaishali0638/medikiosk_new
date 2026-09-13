import { Module } from '@nestjs/common';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { OpsGuard } from '../ops/ops.guard';
import { AlertsService } from './alerts.service';
import { DeviceEventsService } from './device-events.service';
import { MetricsService } from './metrics.service';
import { ObservabilityController } from './observability.controller';

@Module({
  controllers: [ObservabilityController],
  providers: [MetricsService, AlertsService, DeviceEventsService, OpsGuard, KioskDeviceGuard],
  exports: [MetricsService, AlertsService, DeviceEventsService],
})
export class ObservabilityModule {}
