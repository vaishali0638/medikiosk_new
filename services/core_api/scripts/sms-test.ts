/**
 * Sends one real SMS, so credentials can be proved before a patient depends on them.
 *
 * Every part of an Indian SMS setup fails silently somewhere else: a wrong authkey is a
 * 200 with an error in the body, an unregistered sender ID is dropped by the OPERATOR
 * after the gateway accepts it, and a template that does not match the registered wording
 * to the character is discarded the same way. Discovering any of that through "the patient
 * says no code arrived" is the worst possible feedback loop.
 *
 *   npm run sms:test -w @medikiosk/core-api -- 9876543210
 */
import { HttpSmsAdapter } from '../src/sms/http-sms.adapter';
import { SandboxSmsAdapter } from '../src/sms/sms.adapter';
import { loadRepoEnv } from './load-env';

// The API reads .env through Nest; this script is on its own.
loadRepoEnv();

const mobile = process.argv[2];
if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
  process.stderr.write(
    'Usage: npm run sms:test -w @medikiosk/core-api -- <10-digit Indian mobile>\n',
  );
  process.exit(1);
}

const env = process.env;
const adapterKind = env['SMS_ADAPTER'] ?? 'sandbox';

// A recognisable code, not a random one: this is a test message to a real handset and the
// person holding it should be able to tell it apart from a real verification.
const code = '000000';
const message = {
  mobile,
  body: `${code} is your MediKiosk verification code. It expires in 5 minutes. Do not share it.`,
  correlationId: `sms-test-${Date.now()}`,
};

async function main(): Promise<void> {
  process.stdout.write(`\nSMS test → ******${mobile!.slice(-4)}\n`);
  process.stdout.write(`  adapter   ${adapterKind}\n`);

  if (adapterKind !== 'http') {
    process.stdout.write(
      `  provider  —\n\n` +
        `  SMS_ADAPTER is "${adapterKind}", so nothing will reach a handset.\n` +
        `  Set SMS_ADAPTER=http with your gateway's credentials to send for real.\n\n`,
    );
    if (adapterKind === 'sandbox') await new SandboxSmsAdapter().send(message);
    return;
  }

  const provider = env['SMS_PROVIDER'] ?? 'msg91';
  process.stdout.write(`  provider  ${provider}\n`);
  process.stdout.write(`  sender    ${env['SMS_SENDER_ID'] ?? '(unset)'}\n`);
  process.stdout.write(`  template  ${env['SMS_DLT_TEMPLATE_ID'] ?? '(unset)'}\n\n`);

  const adapter = new HttpSmsAdapter({
    provider,
    accountSid: env['SMS_ACCOUNT_SID'],
    url: env['SMS_API_URL'] ?? '',
    apiKey: env['SMS_API_KEY'] ?? '',
    authHeader: env['SMS_AUTH_HEADER'] ?? 'Authorization',
    senderId: env['SMS_SENDER_ID'] ?? '',
    templateId: env['SMS_DLT_TEMPLATE_ID'] ?? '',
    timeoutMs: Number(env['SMS_TIMEOUT_MS'] ?? 8000),
  });

  const result = await adapter.send(message);

  if (result.delivered) {
    process.stdout.write(
      `  ✓ the gateway accepted it${result.providerRef ? ` (ref ${result.providerRef})` : ''}\n\n` +
        `  Accepted is not arrived. If nothing reaches the handset within a minute, the\n` +
        `  operator dropped it after the gateway took it — which in India is almost always\n` +
        `  an unregistered sender ID, or a template that does not match the DLT-registered\n` +
        `  wording exactly. Check both in your provider's DLT console.\n\n`,
    );
    return;
  }

  process.stderr.write(
    `  ✗ the gateway refused it. The reason is in the API log line above this one;\n` +
      `    it is not printed here because the message body contains a code.\n\n`,
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  process.stderr.write(`\n  ✗ ${error instanceof Error ? error.message : String(error)}\n\n`);
  process.exit(1);
});
