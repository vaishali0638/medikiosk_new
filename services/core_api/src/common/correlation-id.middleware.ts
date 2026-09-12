import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { CORRELATION_ID_HEADER } from '@medikiosk/api-contracts';
import type { NextFunction, Request, Response } from 'express';

/** Shape of the correlation context attached to every request. */
export interface CorrelatedRequest extends Request {
  correlationId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Propagates a correlation id across kiosk -> API -> AI worker -> HIS adapter so a
 * single patient journey can be traced end to end without logging patient data.
 *
 * A client-supplied id is only trusted if it is a well-formed UUID; anything else is
 * replaced, so a caller cannot inject log-forging content through this header.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const supplied = req.header(CORRELATION_ID_HEADER);
    const correlationId = supplied && UUID_RE.test(supplied) ? supplied : randomUUID();

    (req as CorrelatedRequest).correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
