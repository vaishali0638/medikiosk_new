import { formatCoverage, loadCoverage, summarise } from './language-coverage';

const coverage = loadCoverage();
process.stdout.write(`${formatCoverage(coverage)}\n`);

// Exit non-zero only for an INCOMPLETE translation, never for an absent one.
//
// A language nobody has translated yet is a known gap the report names; failing CI over it
// would just mean nobody could add the twenty-third language without translating it in the
// same commit. A half-translated one is different: it strands a patient in the middle of
// their own journey, in a language they cannot read, having already given consent.
const partial = coverage.filter((c) => c.shellKeys > 0 && c.shellKeys < c.baselineKeys);
if (partial.length > 0) {
  process.stderr.write(
    `\nIncomplete shell translations: ${partial
      .map((c) => `${c.tag} (${c.shellKeys}/${c.baselineKeys})`)
      .join(', ')}\n` +
      'A partly translated kiosk drops a patient into English mid-journey. Finish the file\n' +
      'or remove it — either is better than half.\n',
  );
  process.exit(1);
}

const summary = summarise(coverage);
process.stdout.write(
  `\n${summary.shellComplete}/${summary.registered} languages have a complete shell translation; ` +
    `${summary.shellReviewed} reviewed by a speaker.\n`,
);
