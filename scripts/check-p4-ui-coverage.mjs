#!/usr/bin/env node
/** Static inventory only: review known P4 selector/API changes in existing UI scripts. */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const rules = [
  { label: 'STALE: lookup heading moved outside .soft-refresh-current; use the live .lookup-heading', pattern: /\.soft-refresh-current\s+\.lookup-heading/g },
  { label: 'STALE: recall-history is now a div; open the records tab instead of summary', pattern: /\.recall-history\s*>\s*summary/g },
  { label: 'BYPASS: direct restore_all IPC bypasses Settings/guard/cache-reset frontend; supplement with actual UI restore', pattern: /(?:call|invoke)\(\s*['"]restore_all['"]/g },
  { label: 'REUSABLE SELECTOR CANDIDATE: desk/library entry; still verify interaction, focus and state', pattern: /\.desk-library-dock|\.library-open(?:\[data-open[^\]]*\])?/g },
  { label: 'REUSABLE SELECTOR CANDIDATE: reader/lookup; still verify interaction, focus and state', pattern: /\.reading-word|\[data-testid=["'](?:lookup-save|lookup-close)["']\]/g },
  { label: 'TEST HARNESS: injected store/failure or test command needs separate native verification', pattern: /__uiStoreModule|__uiFailure|test_reopen/g },
  { label: 'DIRECT IPC: may be native or mocked depending on harness; does not itself test user-facing flow', pattern: /__TAURI_INTERNALS__/g },
];
console.log('P4 UI static inventory — known patterns only; no test is executed and unmatched scripts are unassessed.');
for (const file of (await readdir(dir)).filter(name => /^ui-.*\.mjs$/.test(name)).sort()) {
  const text = await readFile(join(dir, file), 'utf8');
  const lines = text.split('\n');
  const matches = rules.flatMap(rule => {
    const hits = lines.flatMap((line, index) => { rule.pattern.lastIndex = 0; return rule.pattern.test(line) ? [index + 1] : []; });
    return hits.length ? [`  ${rule.label}\n    lines ${hits.join(', ')}`] : [];
  });
  if (matches.length) console.log(`\n${file}\n${matches.join('\n')}`);
}
console.log('\nSelectors are static candidates, not proof of usability, current fixture compatibility, or native coverage.');
console.log('Run isolated browser/native flows and inspect reports separately; historical scripts do not establish P4 acceptance.');
