/**
 * Generates the Dart shell-string tables from the reviewable JSON files.
 * Run via `npm run build -w @medikiosk/terminology`. Do not edit the generated file.
 *
 * The strings live in `infra/i18n/kiosk/*.json` rather than in Dart source so that a
 * translation is a file a speaker of the language can be handed, corrected and sent back
 * without touching the application. That matters more than it sounds: the previous
 * arrangement meant every Odia correction was a Dart pull request, which in practice means
 * no Odia corrections.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { isKnownLanguage } from '../src/languages';

const i18nDir = resolve(__dirname, '../../../infra/i18n/kiosk');
const outPath = resolve(__dirname, '../../../apps/kiosk_flutter/lib/l10n/kiosk_strings.g.dart');

interface ReviewEntry {
  readonly status: 'baseline' | 'unreviewed' | 'reviewed';
  readonly reviewer: string | null;
  readonly reviewedAt: string | null;
}

const review = JSON.parse(readFileSync(resolve(i18nDir, 'REVIEW.json'), 'utf8')) as {
  languages: Record<string, ReviewEntry>;
};

const tags = readdirSync(i18nDir)
  .filter((f) => f.endsWith('.json') && f !== 'REVIEW.json')
  .map((f) => basename(f, '.json'))
  .sort();

const unknown = tags.filter((t) => !isKnownLanguage(t));
if (unknown.length > 0) {
  throw new Error(
    `i18n files for languages absent from the registry: ${unknown.join(', ')}. ` +
      'Add them to packages/terminology/src/languages.ts first — a translation with no ' +
      'endonym cannot be shown on the selection screen.',
  );
}

const tables = new Map<string, Record<string, string>>();
for (const tag of tags) {
  tables.set(tag, JSON.parse(readFileSync(resolve(i18nDir, `${tag}.json`), 'utf8')));
}

const english = tables.get('en');
if (!english) throw new Error('infra/i18n/kiosk/en.json is the baseline and must exist');

/** Dart single-quoted string literal. */
const lit = (s: string): string =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n')}'`;

const table = (tag: string, data: Record<string, string>): string => {
  const rows = Object.entries(data)
    .map(([k, v]) => `  ${lit(k)}: ${lit(v)},`)
    .join('\n');
  return `const Map<String, String> _${tag.replace(/-/g, '_')} = <String, String>{\n${rows}\n};\n`;
};

const statusFor = (tag: string): ReviewEntry =>
  review.languages[tag] ?? { status: 'unreviewed', reviewer: null, reviewedAt: null };

const dartStatus = (tag: string): string => {
  const r = statusFor(tag);
  const coverage = Object.keys(tables.get(tag) ?? {}).filter((k) => k in english).length;
  return `  '${tag}': ShellTranslation(
    status: ShellReviewStatus.${r.status},
    reviewer: ${r.reviewer === null ? 'null' : lit(r.reviewer)},
    reviewedAt: ${r.reviewedAt === null ? 'null' : lit(r.reviewedAt)},
    translatedKeys: ${coverage},
    totalKeys: ${Object.keys(english).length},
  ),`;
};

const dart = `// GENERATED FILE — DO NOT EDIT.
// Source: infra/i18n/kiosk/*.json
// Regenerate with: npm run build -w @medikiosk/terminology

/// How far a shell translation has been checked.
enum ShellReviewStatus {
  /// The English source the others are translated from.
  baseline,

  /// Supplied by a developer or a machine; no speaker of the language has read it.
  unreviewed,

  /// A named person has read every string and signed off, on a recorded date.
  reviewed,
}

/// What is known about one language's shell translation.
class ShellTranslation {
  const ShellTranslation({
    required this.status,
    required this.reviewer,
    required this.reviewedAt,
    required this.translatedKeys,
    required this.totalKeys,
  });

  final ShellReviewStatus status;
  final String? reviewer;
  final String? reviewedAt;
  final int translatedKeys;
  final int totalKeys;

  bool get isComplete => translatedKeys == totalKeys;

  /// A reviewed translation needs a name against it. Status alone is a claim.
  bool get isReviewed => status == ShellReviewStatus.reviewed && reviewer != null;
}

${tags.map((t) => table(t, tables.get(t) as Record<string, string>)).join('\n')}
const Map<String, Map<String, String>> kShellStrings = <String, Map<String, String>>{
${tags.map((t) => `  '${t}': _${t.replace(/-/g, '_')},`).join('\n')}
};

const Map<String, ShellTranslation> kShellTranslationStatus = <String, ShellTranslation>{
${tags.map(dartStatus).join('\n')}
};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, dart, 'utf8');
process.stdout.write(`kiosk shell strings (${tags.length} languages) -> ${outPath}\n`);
