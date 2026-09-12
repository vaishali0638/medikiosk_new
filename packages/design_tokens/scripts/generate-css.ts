/**
 * Generates CSS custom properties for the web surfaces (patient PWA, doctor/governance web).
 * Run via `npm run tokens:build`. Do not edit the generated file by hand.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { colors, spacing, radius, typography } from '../src/tokens';

const here = __dirname;
const outPath = resolve(here, '../dist/tokens.css');

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const lines: string[] = [];
for (const [name, hex] of Object.entries(colors))
  lines.push(`  --mk-color-${kebab(name)}: ${hex};`);
for (const [name, v] of Object.entries(spacing)) lines.push(`  --mk-space-${name}: ${v}px;`);
for (const [name, v] of Object.entries(radius)) lines.push(`  --mk-radius-${name}: ${v}px;`);
for (const [name, t] of Object.entries(typography)) {
  lines.push(`  --mk-font-size-${name}: ${t.sizeSp}px;`);
  lines.push(`  --mk-font-weight-${name}: ${t.weight};`);
  lines.push(`  --mk-line-height-${name}: ${t.lineHeight};`);
}

const css = `/* GENERATED FILE — DO NOT EDIT.
   Source: packages/design_tokens/src/tokens.ts
   Regenerate with: npm run tokens:build */

:root {
${lines.join('\n')}
}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, css, 'utf8');
process.stdout.write(`design tokens -> ${outPath}\n`);
