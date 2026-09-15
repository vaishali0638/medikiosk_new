import { HttpSmsAdapter, type HttpSmsConfig } from './http-sms.adapter';

const config: HttpSmsConfig = {
  url: 'https://gateway.example/api/send',
  apiKey: 'secret-key-value',
  authHeader: 'authkey',
  senderId: 'AYUSHK',
  templateId: 'dlt-template-1',
  timeoutMs: 50,
};

const message = {
  mobile: '9876543210',
  body: '123456 is your MediKiosk verification code.',
  correlationId: 'corr-1',
};

const ok = (headers: Record<string, string> = {}): Response =>
  new Response('{}', { status: 200, headers });

describe('HttpSmsAdapter', () => {
  it('sends the number with the country code the gateway needs', async () => {
    let body: Record<string, unknown> = {};
    const adapter = new HttpSmsAdapter(config, (async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return ok();
    }) as typeof fetch);

    await adapter.send(message);

    // The contract stores ten digits without the country code, and a gateway handed a bare
    // ten-digit number routes it nowhere.
    expect(body['mobiles']).toBe('919876543210');
  });

  it('sends the sender id and DLT template, without which the operator drops the message', async () => {
    let body: Record<string, unknown> = {};
    const adapter = new HttpSmsAdapter(config, (async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return ok();
    }) as typeof fetch);

    await adapter.send(message);

    expect(body['sender']).toBe('AYUSHK');
    expect(body['template_id']).toBe('dlt-template-1');
  });

  it('puts the credential in the configured header, because MSG91 does not use Authorization', async () => {
    let headers: Record<string, string> = {};
    const adapter = new HttpSmsAdapter(config, (async (_url, init) => {
      headers = (init as RequestInit).headers as Record<string, string>;
      return ok();
    }) as typeof fetch);

    await adapter.send(message);

    expect(headers['authkey']).toBe('secret-key-value');
  });

  it('reports a refusal as undelivered rather than as success', async () => {
    const adapter = new HttpSmsAdapter(
      config,
      (async () => new Response('denied', { status: 401 })) as typeof fetch,
    );

    // The alternative is a code that silently never arrives, which is the worst outcome
    // available: the patient waits and nobody is told.
    await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
  });

  it('gives up rather than leaving a patient waiting on a hung gateway', async () => {
    const adapter = new HttpSmsAdapter(
      config,
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
    const adapter = new HttpSmsAdapter(config, (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);

    await expect(adapter.send(message)).resolves.toEqual({ delivered: false });
  });

  it('never writes the one-time code or the full number to the log', async () => {
    const written: string[] = [];
    const adapter = new HttpSmsAdapter(
      config,
      (async () => new Response('nope', { status: 500 })) as typeof fetch,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).logger = { error: (line: string) => written.push(line) };

    await adapter.send(message);

    const log = written.join('\n');
    expect(log).not.toContain('123456');
    expect(log).not.toContain('9876543210');
    expect(log).toContain('corr-1');
  });
});
