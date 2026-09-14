/**
 * How far each language actually works, per gate, computed rather than asserted.
 *
 * "MediKiosk supports all Indian regional languages" is the kind of claim that is either
 * measurable or marketing. This module makes it measurable, by separating the four
 * independent things that have to be true before a patient can use the kiosk in their
 * language:
 *
 *   1. REGISTERED   — the platform knows the language's name, script and direction.
 *   2. SHELL        — the buttons, titles and error wording are translated.
 *   3. REVIEWED     — a named speaker of the language has read those strings.
 *   4. CLINICAL     — a practitioner has approved the consent notice and questionnaire
 *                     in that language, and a version is published.
 *
 * Only the first three are visible from this repository. The fourth lives in the
 * governance registry per hospital and is deliberately reported as unknown here rather
 * than guessed at — a tool that printed "ready" for a language with no approved consent
 * notice would be worse than no tool.
 *
 * Spoken guidance is a fifth condition and is a property of the DEVICE, not the repo: it
 * depends on which voices the kiosk's text-to-speech engine has installed, which the
 * kiosk reports at startup via `AudioGuidance.supportedLanguages`.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { LANGUAGES, type LanguageEntry } from '@medikiosk/terminology';

export type ShellStatus = 'baseline' | 'reviewed' | 'unreviewed' | 'untranslated';

export interface LanguageCoverage {
  readonly tag: string;
  readonly endonym: string;
  readonly englishName: string;
  readonly script: string;
  readonly direction: string;
  readonly eighthSchedule: boolean;
  /** Translated shell keys, out of the English baseline's total. */
  readonly shellKeys: number;
  readonly baselineKeys: number;
  readonly shellStatus: ShellStatus;
  /** Named reviewer, when one has signed off. */
  readonly reviewer: string | null;
  /** True when the script has no font on a stock Android device. */
  readonly needsBundledFont: boolean;
}

export interface CoverageSummary {
  readonly registered: number;
  readonly eighthSchedule: number;
  readonly shellComplete: number;
  readonly shellReviewed: number;
  readonly untranslated: readonly string[];
  /**
   * Always present, always the same shape: the gates this repository cannot answer.
   * Kept in the output rather than in a comment so that anybody reading the report sees
   * what it does not tell them.
   */
  readonly notVisibleHere: readonly string[];
}

const SCRIPTS_WITHOUT_STOCK_FONT = new Set(['Mtei', 'Olck']);

interface ReviewFile {
  readonly languages: Record<
    string,
    { status: 'baseline' | 'unreviewed' | 'reviewed'; reviewer: string | null }
  >;
}

/** Reads the shell translations from disk. `dir` defaults to `infra/i18n/kiosk`. */
export function loadCoverage(dir?: string): readonly LanguageCoverage[] {
  const i18nDir = dir ?? resolve(__dirname, '../../infra/i18n/kiosk');
  const reviewPath = resolve(i18nDir, 'REVIEW.json');
  const review: ReviewFile = existsSync(reviewPath)
    ? (JSON.parse(readFileSync(reviewPath, 'utf8')) as ReviewFile)
    : { languages: {} };

  const present = new Set(
    readdirSync(i18nDir)
      .filter((f) => f.endsWith('.json') && f !== 'REVIEW.json')
      .map((f) => basename(f, '.json')),
  );

  const baseline = Object.keys(
    JSON.parse(readFileSync(resolve(i18nDir, 'en.json'), 'utf8')) as Record<string, string>,
  );

  return LANGUAGES.map((language: LanguageEntry): LanguageCoverage => {
    const translated = present.has(language.tag)
      ? (JSON.parse(readFileSync(resolve(i18nDir, `${language.tag}.json`), 'utf8')) as Record<
          string,
          string
        >)
      : {};

    const entry = review.languages[language.tag];
    const reviewer = entry?.reviewer ?? null;

    let shellStatus: ShellStatus = 'untranslated';
    if (present.has(language.tag)) {
      if (entry?.status === 'baseline') shellStatus = 'baseline';
      // A 'reviewed' status with nobody's name against it is not a review. Downgrading it
      // here rather than trusting the file means the claim cannot be made by editing one
      // word in a JSON document.
      else if (entry?.status === 'reviewed' && reviewer !== null) shellStatus = 'reviewed';
      else shellStatus = 'unreviewed';
    }

    return {
      tag: language.tag,
      endonym: language.endonym,
      englishName: language.englishName,
      script: language.script,
      direction: language.direction,
      eighthSchedule: language.eighthSchedule,
      shellKeys: baseline.filter((k) => k in translated).length,
      baselineKeys: baseline.length,
      shellStatus,
      reviewer,
      needsBundledFont: SCRIPTS_WITHOUT_STOCK_FONT.has(language.script),
    };
  });
}

export function summarise(coverage: readonly LanguageCoverage[]): CoverageSummary {
  return {
    registered: coverage.length,
    eighthSchedule: coverage.filter((c) => c.eighthSchedule).length,
    shellComplete: coverage.filter((c) => c.shellKeys === c.baselineKeys).length,
    shellReviewed: coverage.filter((c) => c.shellStatus === 'reviewed').length,
    untranslated: coverage.filter((c) => c.shellStatus === 'untranslated').map((c) => c.tag),
    notVisibleHere: [
      'Clinical approval of the consent notice and questionnaire, per language — governance registry, per hospital.',
      'Whether a published version exists in that language — governance registry, per hospital.',
      'Whether the kiosk device has a voice installed for it — reported by the device at startup.',
    ],
  };
}

/** Human-readable report, for CI output and for a hospital deciding what to translate next. */
export function formatCoverage(coverage: readonly LanguageCoverage[]): string {
  const summary = summarise(coverage);
  const lines: string[] = [
    'Language coverage',
    '',
    `Registered: ${summary.registered} (${summary.eighthSchedule} Eighth Schedule + English)`,
    `Shell translated: ${summary.shellComplete}/${summary.registered}`,
    `Shell reviewed by a speaker: ${summary.shellReviewed}/${summary.registered}`,
    '',
    'tag   language        script  dir  shell            review',
    '----  --------------  ------  ---  ---------------  ------------------',
  ];

  for (const c of coverage) {
    const shell =
      c.shellStatus === 'untranslated' ? 'not translated' : `${c.shellKeys}/${c.baselineKeys}`;
    const note = c.shellStatus === 'reviewed' ? (c.reviewer ?? '') : c.shellStatus;
    const font = c.needsBundledFont ? '  (needs bundled font)' : '';
    lines.push(
      `${c.tag.padEnd(4)}  ${c.englishName.padEnd(14)}  ${c.script.padEnd(6)}  ` +
        `${c.direction.padEnd(3)}  ${shell.padEnd(15)}  ${note}${font}`,
    );
  }

  lines.push('', 'Not answerable from this repository:');
  for (const gate of summary.notVisibleHere) lines.push(`  - ${gate}`);

  return lines.join('\n');
}
