/**
 * Reads the repository-root `.env` into `process.env` for the standalone CLIs.
 *
 * The API gets this from `ConfigModule.forRoot({ envFilePath: [...] })`; the scripts in
 * this directory are separate processes and get nothing, so each one that needs
 * configuration calls this first. Without it, `npm run seed -w @medikiosk/core-api` on a
 * machine configured by the Supabase runbook — which puts a `.env` at the repository root
 * — connects to libpq's default instead, and the error names the operating-system user
 * rather than the setting that is missing.
 *
 * Two properties this has to have:
 *
 *  - **An existing variable always wins.** CI passes `DATABASE_URL` in the job
 *    environment and there is no `.env` there at all; a developer overriding it for one
 *    command must not be silently overruled by a file. So this only fills in gaps.
 *  - **Multi-line quoted values survive.** `QR_SIGNING_KEY` is a PKCS8 PEM spanning three
 *    lines. The line-at-a-time readers this replaces matched the first line only and set
 *    the key to `-----BEGIN PRIVATE KEY-----`, which is not a key; it went unnoticed
 *    because the scripts that read the file do not sign anything.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repository root first, then the current directory, matching the API's resolution order. */
const CANDIDATES = [resolve(__dirname, '../../../.env'), resolve('.env')];

function parse(text: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue; // comments, blanks, and the continuation lines consumed below

    const key = match[1] as string;
    let rest = match[2] ?? '';

    const quote = rest.startsWith('"') ? '"' : rest.startsWith("'") ? "'" : '';
    if (!quote) {
      // Unquoted: a `#` starts a trailing comment, and the value cannot span lines.
      values.set(key, rest.split('#')[0]?.trim() ?? '');
      continue;
    }

    rest = rest.slice(1);
    const collected: string[] = [];
    // Consume lines until the closing quote, so a PEM arrives whole.
    for (;;) {
      const end = rest.indexOf(quote);
      if (end !== -1) {
        collected.push(rest.slice(0, end));
        break;
      }
      collected.push(rest);
      i += 1;
      if (i >= lines.length) break; // unterminated quote: keep what there was
      rest = lines[i] ?? '';
    }
    values.set(key, collected.join('\n'));
  }

  return values;
}

/** Returns the path it read, or null when there was no `.env` to read. */
export function loadRepoEnv(): string | null {
  const path = CANDIDATES.find((candidate) => existsSync(candidate));
  if (!path) return null;

  for (const [key, value] of parse(readFileSync(path, 'utf8'))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return path;
}
