/**
 * Boots the COMPILED artifact and probes it.
 *
 * This exists because of a failure the test suite structurally cannot catch: NestJS
 * resolves constructor dependencies from `emitDecoratorMetadata`, and whether that
 * metadata exists depends on the compiler, not the source. ts-jest emits it, so every
 * unit and integration test passed while `tsx` (esbuild, which does not emit it) produced
 * a binary whose controllers had undefined dependencies.
 *
 * Testing the source therefore proves nothing about the artifact. This runs `dist/main.js`
 * — the exact thing the Docker image runs — and fails if it cannot serve a ready check.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env['SMOKE_PORT'] ?? 3199);
const entry = resolve(__dirname, '../dist/main.js');

async function main(): Promise<void> {
  const child = spawn('node', [entry], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const fail = (message: string): never => {
    child.kill('SIGKILL');
    process.stderr.write(`smoke: ${message}\n\n${output}\n`);
    process.exit(1);
  };

  try {
    let ready: Response | undefined;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) fail(`process exited with code ${child.exitCode}`);
      try {
        ready = await fetch(`http://localhost:${PORT}/health/ready`);
        break;
      } catch {
        await delay(500);
      }
    }
    if (!ready) fail('server did not start within 30s');

    const body = (await ready.json()) as { checks?: Record<string, string> };
    if (body.checks?.['database'] !== 'ok') {
      fail(`database check was "${body.checks?.['database']}", expected "ok"`);
    }

    // The DI regression this script exists for shows up as a 500 from any controller with
    // injected dependencies, so probe one rather than trusting the health endpoint alone.
    const config = await fetch(`http://localhost:${PORT}/v1/kiosk/config`, {
      headers: { 'x-kiosk-device': process.env['SMOKE_KIOSK_CODE'] ?? 'MK-OPD-01' },
    });
    if (config.status !== 200) {
      fail(`GET /v1/kiosk/config returned ${config.status}: ${await config.text()}`);
    }
    const parsed = (await config.json()) as { hospitalName?: string };
    if (!parsed.hospitalName) fail('kiosk config response was missing hospitalName');

    process.stdout.write(`smoke: ok (compiled artifact serves ${parsed.hospitalName})\n`);
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
