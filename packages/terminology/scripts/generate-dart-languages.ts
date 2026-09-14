/**
 * Generates the Dart mirror of the canonical language registry.
 * Run via `npm run build -w @medikiosk/terminology`. Do not edit the generated file.
 *
 * The registry is generated rather than hand-maintained on both sides for the same reason
 * the design tokens are: an endonym that differs between the server's list and the kiosk's
 * is a bug nobody notices until a patient sees the wrong name for their own language.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LANGUAGES, SCRIPTS_NEEDING_BUNDLED_FONT } from '../src/languages';

const outPath = resolve(__dirname, '../../../apps/kiosk_flutter/lib/l10n/indian_languages.dart');

const entries = LANGUAGES.map(
  (l) => `  IndianLanguage(
    tag: '${l.tag}',
    endonym: '${l.endonym}',
    englishName: '${l.englishName}',
    script: '${l.script}',
    direction: ${l.direction === 'rtl' ? 'TextDirection.rtl' : 'TextDirection.ltr'},
    eighthSchedule: ${l.eighthSchedule},
  ),`,
).join('\n');

const fonts = SCRIPTS_NEEDING_BUNDLED_FONT.map((s) => `'${s}'`).join(', ');

const dart = `// GENERATED FILE — DO NOT EDIT.
// Source: packages/terminology/src/languages.ts
// Regenerate with: npm run build -w @medikiosk/terminology

import 'dart:ui' show TextDirection;

import 'package:flutter/foundation.dart';

/// One language the platform knows the name, script and reading direction of.
///
/// Presence here is not permission to offer it. See the registry's own header: the
/// clinical review, the published consent notice and the available voice are separate
/// gates, checked elsewhere.
@immutable
class IndianLanguage {
  const IndianLanguage({
    required this.tag,
    required this.endonym,
    required this.englishName,
    required this.script,
    required this.direction,
    required this.eighthSchedule,
  });

  /// BCP-47 tag.
  final String tag;

  /// The language's name in its own script — what the patient reads.
  final String endonym;

  /// The English name, for staff screens and logs only.
  final String englishName;

  /// ISO 15924 script code.
  final String script;

  final TextDirection direction;

  /// Whether the language is in the Eighth Schedule to the Constitution.
  final bool eighthSchedule;

  /// Whether this script needs a font bundled with the build to render at all.
  bool get needsBundledFont => kScriptsNeedingBundledFont.contains(script);
}

const List<String> kScriptsNeedingBundledFont = <String>[${fonts}];

const List<IndianLanguage> kIndianLanguages = <IndianLanguage>[
${entries}
];

final Map<String, IndianLanguage> _byTag = <String, IndianLanguage>{
  for (final IndianLanguage l in kIndianLanguages) l.tag: l,
};

IndianLanguage? findLanguage(String tag) => _byTag[tag];

bool isKnownLanguage(String tag) => _byTag.containsKey(tag);
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, dart, 'utf8');
process.stdout.write(`language registry -> ${outPath}\n`);
