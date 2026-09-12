import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '@medikiosk/api-contracts';
import { CorrelationIdMiddleware, type CorrelatedRequest } from './correlation-id.middleware';

function makeReq(headerValue?: string): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === CORRELATION_ID_HEADER ? headerValue : undefined,
  } as unknown as Request;
}

function makeRes(): { res: Response; headers: Record<string, unknown> } {
  const headers: Record<string, unknown> = {};
  const res = {
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { res, headers };
}

describe('CorrelationIdMiddleware', () => {
  const middleware = new CorrelationIdMiddleware();

  it('generates a correlation id when the client sends none', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    middleware.use(req, res, () => undefined);

    const id = (req as CorrelatedRequest).correlationId;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers[CORRELATION_ID_HEADER]).toBe(id);
  });

  it('preserves a well-formed client correlation id so a journey stays traceable', () => {
    const supplied = '3f2b8a1c-9d4e-4f6a-b0c1-2d3e4f5a6b7c';
    const req = makeReq(supplied);
    const { res } = makeRes();
    middleware.use(req, res, () => undefined);
    expect((req as CorrelatedRequest).correlationId).toBe(supplied);
  });

  it('replaces a malformed id rather than echoing attacker-controlled text into logs', () => {
    const req = makeReq('not-a-uuid\ninjected log line');
    const { res } = makeRes();
    middleware.use(req, res, () => undefined);
    expect((req as CorrelatedRequest).correlationId).not.toContain('injected');
  });

  it('always calls next', () => {
    let called = false;
    middleware.use(makeReq(), makeRes().res, () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});
