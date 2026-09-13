import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { IdentityModule } from '../identity/identity.module';
import { PatientChannelController } from './patient-channel.controller';
import { PatientChannelGuard } from './patient-channel.guard';

@Module({
  imports: [ConsentModule, IdentityModule],
  controllers: [PatientChannelController],
  providers: [PatientChannelGuard],
})
export class PatientChannelModule {}
