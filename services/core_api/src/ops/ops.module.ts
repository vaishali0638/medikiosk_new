import { Module } from '@nestjs/common';
import { ArrivalModule } from '../arrival/arrival.module';
import { OpsController } from './ops.controller';
import { OpsGuard } from './ops.guard';

@Module({
  imports: [ArrivalModule],
  controllers: [OpsController],
  providers: [OpsGuard],
})
export class OpsModule {}
