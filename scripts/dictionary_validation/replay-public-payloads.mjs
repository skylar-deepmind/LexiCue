/** Offline evidence only: exact original data.js selectors over earlier captured HTML.
 * Never sends an HTTP request. These are NOT responses from the deployed author API.
 * The capture used /dictionary rather than the author's /us/dictionary route.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as cheerio from '../../services/cambridge-dictionary-api/node_modules/cheerio/dist/esm/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const captureDir = `${root}docs/implementation/evidence/cambridge-online-v1/service`;
const output = process.env.LEXICUE_PUBLIC_REPLAY_OUTPUT || `${root}docs/implementation/evidence/cambridge-public-v1/replay`;
const upstreamPath = `${root}services/cambridge-dictionary-api/upstream/data.js`;
const upstream = await readFile(upstreamPath, 'utf8');
const start = upstream.indexOf('    const $ = cheerio.load(dictionaryResponse.value.data);');
const end = upstream.indexOf('    setCache(mainCacheKey, result);', start);
if (start < 0 || end < start) throw Error('Upstream selector boundaries changed; review before replaying');
const selectorBlock = upstream.slice(start, end);
// Execute only the unchanged extraction block, with no HTTP client or filesystem.
// The explicit empty verbs array reflects an omitted, separate Wiktionary request.
const extract = new Function('cheerio', 'dictionaryResponse', 'verbs', 'res', `${selectorBlock}\nreturn result;`);
const sha = value => createHash('sha256').update(value).digest('hex');
const pages = JSON.parse(await readFile(`${captureDir}/pages.json`, 'utf8'));
const cases = [
  ['record', 'record', 'record.json'],
  ['doomscrolling', 'doomscrolling', 'doomscrolling.json'],
  ['US', 'US', 'us-uppercase.json'],
  ['us', 'us', 'us-lowercase.json'],
  ['took', 'took', 'took.json'],
  ['look it up', 'look up', 'look-it-up.json'],
  ['cost an arm and a leg', 'cost an arm and a leg', 'cost-an-arm-and-a-leg.json'],
  ['a red car', 'a red car', 'a-red-car.json'],
];
await mkdir(output, { recursive: true });
const results = [];
for (const [query, capturedQuery, file] of cases) {
  const source = pages.find(page => page.text === capturedQuery);
  if (!source) throw Error(`No recorded source HTML for ${capturedQuery}`);
  const html = await readFile(`${captureDir}/${source.file}`);
  if (sha(html) !== source.sha256) throw Error(`Capture fingerprint mismatch: ${source.file}`);
  let httpStatus = 200;
  const res = { status(code) { httpStatus = code; return this; }, json(value) { return value; } };
  const payload = extract(cheerio, { value: { data: html.toString('utf8') } }, { status: 'fulfilled', value: [] }, res);
  const encoded = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(`${output}/${file}`, encoded);
  results.push({ query, file, http_status_from_source_extraction: httpStatus,
    payload_sha256: sha(encoded), returned_word: payload.word ?? null,
    definition_count: payload.definition?.length ?? 0,
    pronunciation_count: payload.pronunciation?.length ?? 0,
    captured_query: capturedQuery, source_html: `${captureDir}/${source.file}`,
    source_html_sha256: source.sha256, source_url: source.url, source_final_url: source.final_url,
    source_fetched_at: source.fetched_at,
    limitation: query !== capturedQuery ? 'No captured look it up HTTP response; exact selectors applied to the captured look up page. Query-to-page equivalence is unverified.' : null });
}
const manifest = { evidence_mode: 'offline_original_selector_replay_of_prior_real_html',
  live_author_api_responses: false, external_requests: 0,
  generated_at: new Date().toISOString(), upstream_path: upstreamPath,
  upstream_sha256: sha(upstream), selector_block_sha256: sha(selectorBlock),
  limitations: [
    'Captured source URLs use /dictionary, while the author source constructs /us/dictionary. These replays do not establish deployed service equivalence, availability or live success.',
    'The deployed author version is unknown. Extraction uses the preserved original data.js source verbatim.',
    'The unrelated Wiktionary verbs request is omitted; verbs is an explicit empty array and is never ingested by the application.',
    'This is full-page flattened extraction with no keyword filtering, sense repair or fabricated definitions.',
    'look it up uses a captured look up page; that query-to-page transport relationship is unverified.',
  ], results };
await writeFile(`${output}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, external_requests: 0, results: results.map(({ query, file, returned_word, definition_count, http_status_from_source_extraction }) => ({ query, file, returned_word, definition_count, http_status_from_source_extraction })) }, null, 2));
