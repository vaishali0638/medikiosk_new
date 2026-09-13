import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiError, CORRELATION_ID_HEADER } from '@medikiosk/api-contracts';
import type { Request, Response } from 'express';
import { DomainError, StaffFacingError } from './domain-error';
import { InvalidStateTransitionError } from '../state-machines';
import { redact } from './redact';
import type { CorrelatedRequest } from './correlation-id.middleware';

/**
 * Turns every failure into a patient-safe response body.
 *
 * An unexpected exception is logged with its correlation id and answered with a generic
 * INTERNAL_ERROR. Stack traces, SQL text and constraint names are useful to operators and
 * dangerous on a kiosk screen, so nothing but the mapped code and neutral message crosses
 * this boundary.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const correlationId =
      (request as CorrelatedRequest).correlationId ??
      request.header(CORRELATION_ID_HEADER) ??
      '00000000-0000-4000-8000-000000000000';

    // Checked before DomainError: it is a subclass, and the reason is the whole point.
    if (exception instanceof StaffFacingError) {
      this.logger.warn(
        `${exception.code} correlationId=${correlationId} ${exception.internalDetail}`,
      );
      response.status(exception.getStatus()).json({
        ...(exception.getResponse() as Record<string, unknown>),
        detail: exception.internalDetail,
      });
      return;
    }

    if (exception instanceof DomainError) {
      this.logger.warn(
        `${exception.code} correlationId=${correlationId} ${exception.internalDetail ?? ''}`,
      );
      // A DomainError raised from a pipe has no correlation id: pipes run before any
      // handler and cannot see the request. The body is rebuilt with the request's own id
      // so every response the client gets is traceable, wherever it was raised.
      const body = exception.correlationId
        ? exception.getResponse()
        : apiError(exception.code, correlationId);
      response.status(exception.getStatus()).json(body);
      return;
    }

    // An illegal transition means either a client bug or an attempt to skip a gate.
    if (exception instanceof InvalidStateTransitionError) {
      this.logger.warn(
        `INVALID_STATE_TRANSITION correlationId=${correlationId} ` +
          `${exception.machine}: ${exception.from} -> ${exception.to}`,
      );
      const body = apiError('INVALID_STATE_TRANSITION', correlationId);
      response.status(HttpStatus.CONFLICT).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === HttpStatus.NOT_FOUND ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';
      response.status(status).json(apiError(code, correlationId));
      return;
    }

    this.logger.error(
      `INTERNAL_ERROR correlationId=${correlationId} ` +
        JSON.stringify(redact({ message: (exception as Error)?.message })),
      (exception as Error)?.stack,
    );
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(apiError('INTERNAL_ERROR', correlationId));
  }
}
