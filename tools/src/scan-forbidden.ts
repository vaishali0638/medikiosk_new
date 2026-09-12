import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FORBIDDEN_OPTIONS, SCANNED_EXTENSIONS, SCANNED_ROOTS } from './forbidden-options';

export interface ForbiddenHit {
  readonly file: string;
  readonly line: number;
  readonly phrase: string;
  readonly excerpt: string;
}

const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.dart_tool', '.next', '.git']);

/**
 * A source line may legitimately mention a banned phrase when it is the guard itself
 * (a test asserting absence, or a comment explaining the ban). Those lines opt out with
 * an explicit marker so the exemption is visible at the call site.
 */
const EXEMPTION_MARKER = 'forbidden-option-scan:allow';

export function listFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return []; // A not-yet-created app directory is not a failure.
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFiles(full));
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

/** Scans a single file's content. Exported separately so it is directly testable. */
export function scanContent(file: string, content: string): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    if (line.includes(EXEMPTION_MARKER)) return;
    for (const phrase of FORBIDDEN_OPTIONS) {
      // Case-insensitive: "ENTER TOKEN" is just as forbidden as "Enter token".
      if (line.toLowerCase().includes(phrase.toLowerCase())) {
        hits.push({ file, line: index + 1, phrase, excerpt: line.trim().slice(0, 120) });
      }
    }
  });

  return hits;
}

export function scanRepository(
  repoRoot: string,
  roots: readonly string[] = SCANNED_ROOTS,
): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const root of roots) {
    for (const file of listFiles(join(repoRoot, root))) {
      hits.push(...scanContent(relative(repoRoot, file), readFileSync(file, 'utf8')));
    }
  }
  return hits;
}
