import { Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentModule } from '../consent/consent.module';
import { QrNonceRepository } from '../arrival/qr-nonce.repository';
import { PreCheckinController } from './precheckin.controller';
import { PreCheckinService } from './precheckin.service';
import { QrTokenService } from './qr-token.service';

@Module({
  imports: [ConsentModule],
  controllers: [PreCheckinController],
  providers: [PreCheckinService, QrTokenService, QrNonceRepository, AuditRepository],
  exports: [PreCheckinService, QrTokenService],
})
export class PreCheckinModule {}
