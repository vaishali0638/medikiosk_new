import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { AnswerRepository } from './answer.repository';
import { IntakeController } from './intake.controller';
import { QuestionnaireService } from './questionnaire.service';

@Module({
  imports: [ConsentModule, PreCheckinModule],
  controllers: [IntakeController],
  providers: [QuestionnaireService, AnswerRepository, KioskDeviceGuard],
  exports: [QuestionnaireService, AnswerRepository],
})
export class IntakeModule {}
