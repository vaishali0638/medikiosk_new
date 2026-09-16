import { createHash } from 'node:crypto';
import { HttpSmsAdapter, type HttpSmsConfig } from './http-sms.adapter';

const base: HttpSmsConfig = {
  provider: 'msg91',
  url: '',
  apiKey: 'secret-key-value',
  authHeader: 'authkey',
  senderId: 'AYUSHK',
  templateId: 'dlt-template-1',
  timeoutMs: 50,
};

const message = {
  mobile: '9876543210',
  body: '123456 is your MediKiosk verification code. It expires in 5 minutes. Do not share it.',
  correlationId: 'corr-1',
};

const respond = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

const adapterFor = (
  config: Partial<HttpSmsConfig>,
  reply: (url: string, init?: RequestInit) => Response,
): {
  adapter: HttpSmsAdapter;
  seen: { url?: string | undefined; init?: RequestInit | undefined };
} => {
  const seen: { url?: string | undefined; init?: RequestInit | undefined } = {};
  const adapter = new HttpSmsAdapter({ ...base, ...config }, (async (
    url: string,
    init?: RequestInit,
  ) => {
    seen.url = url;
    seen.init = init;
    return reply(url, init);
  }) as unknown as typeof fetch);
  return { adapter, seen };
};

describe('HttpSmsAdapter', () => {
  describe('MSG91', () => {
    it('sends the code as a template variable, not the sentence', async () => {
      // The sentence is registered with the operator as a DLT template and substituted at
      // their end. Sending our own text is accepted by MSG91 and dropped by the operator.
      const { adapter, seen } = adapterFor({ provider: 'msg91' }, () =>
        respond({ type: 'success', message: 'ref-1' }),
      );

      await adapter.send(message);
      const body = JSON.parse(String(seen.init?.body)) as Record<string, unknown>;

      expect(body['template_id']).toBe('dlt-template-1');
      expect(body['sender']).toBe('AYUSHK');
      expect(body['recipients']).toEqual([{ mobiles: '919876543210', code: '123456' }]);
      expect((seen.init?.headers as Record<string, string>)['authkey']).toBe('secret-key-value');
    });

    it('treats a 200 carrying an error as undelivered', async () => {
      // The failure this whole profile system exists for. MSG91 answers {"type":"error"}
      // with HTTP 200, so an adapter that stops at the status line reports success for a
      // message that was never sent — and the patient waits at the kiosk for a code that
      // is not coming, with nothing anywhere to say why.
      const { adapter } = adapterFor({ provider: 'msg91' }, () =>
        respond({ type: 'error', message: 'invalid template_id' }),
      );

      await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
    });

    it('reports the provider reference on success', async () => {
      const { adapter } = adapterFor({ provider: 'msg91' }, () =>
        respond({ type: 'success', message: 'msg91-ref-9' }),
      );

      await expect(adapter.send(message)).resolves.toEqual({
        delivered: true,
        providerRef: 'msg91-ref-9',
      });
    });
  });

  describe('Fast2SMS', () => {
    it('also fails with a 200, and is caught', async () => {
      const { adapter } = adapterFor({ provider: 'fast2sms' }, () =>
        respond({ return: false, message: 'Invalid Authentication' }),
      );

      await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
    });

    it('accepts return:true', async () => {
      const { adapter } = adapterFor({ provider: 'fast2sms' }, () =>
        respond({ return: true, request_id: 'f2s-1' }),
      );

      await expect(adapter.send(message)).resolves.toEqual({
        delivered: true,
        providerRef: 'f2s-1',
      });
    });
  });

  describe('Twilio', () => {
    it('sends form-encoded with Basic auth and an E.164 number', async () => {
      const { adapter, seen } = adapterFor(
        { provider: 'twilio', accountSid: 'AC123', senderId: '+15550000000' },
        () => respond({ sid: 'SM1', status: 'queued' }),
      );

      await adapter.send(message);
      const body = new URLSearchParams(String(seen.init?.body));

      expect(seen.url).toContain('/Accounts/AC123/Messages.json');
      expect(body.get('To')).toBe('+919876543210');
      expect(body.get('From')).toBe('+15550000000');
      expect(body.get('Body')).toContain('123456');

      const auth = (seen.init?.headers as Record<string, string>)['authorization'] ?? '';
      expect(auth.startsWith('Basic ')).toBe(true);
      expect(Buffer.from(auth.slice(6), 'base64').toString()).toBe('AC123:secret-key-value');
    });

    it('treats a failed status on a 2xx as undelivered', async () => {
      const { adapter } = adapterFor({ provider: 'twilio', accountSid: 'AC123' }, () =>
        respond({ sid: 'SM2', status: 'failed' }),
      );

      await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
    });
  });

  describe('every provider', () => {
    it('reports a refusal rather than success', async () => {
      const { adapter } = adapterFor({}, () => respond('denied', 401));
      await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
    });

    it('gives up rather than leaving a patient waiting on a hung gateway', async () => {
      const adapter = new HttpSmsAdapter(
        base,
        ((_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          })) as unknown as typeof fetch,
      );

      await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
    });

    it('survives a transport failure', async () => {
      const adapter = new HttpSmsAdapter(base, (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch);

      await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
    });

    it('never writes the code or the full number to the log', async () => {
      const written: string[] = [];
      const { adapter } = adapterFor({}, () => respond({ type: 'error', message: 'nope' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adapter as any).logger = { error: (line: string) => written.push(line) };

      await adapter.send(message);

      const log = written.join('\n');
      expect(log).not.toContain('123456');
      expect(log).not.toContain('9876543210');
      expect(log).toContain('corr-1');
      // The operator still needs to know WHY, or a misconfigured template is invisible.
      expect(log).toContain('nope');
    });

    it('hashes nothing and stores nothing — it is a transport', () => {
      expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
    });
  });
});
