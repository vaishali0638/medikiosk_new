import { resolve } from 'node:path';
import { FORBIDDEN_OPTIONS } from './forbidden-options';
import { scanRepository } from './scan-forbidden';

const repoRoot = resolve(__dirname, '../..');
const hits = scanRepository(repoRoot);

if (hits.length === 0) {
  process.stdout.write(
    `forbidden-option scan: clean (${FORBIDDEN_OPTIONS.length} banned phrases checked)\n`,
  );
  process.exit(0);
}

process.stderr.write(`forbidden-option scan: ${hits.length} violation(s)\n\n`);
for (const hit of hits) {
  process.stderr.write(`  ${hit.file}:${hit.line}  "${hit.phrase}"\n    ${hit.excerpt}\n`);
}
process.stderr.write(
  '\nThese options are banned from the patient-facing UI. Remove them, or if this line is\n' +
    'part of the guard itself, mark it with the forbidden-option-scan allow marker.\n',
);
process.exit(1);
