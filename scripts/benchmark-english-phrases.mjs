#!/usr/bin/env node
/** Real pinned Gemma benchmark. Temporary databases; no writes to the learning library. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = path.resolve(option('--output', path.join(os.tmpdir(), `lexicue-phrases-${Date.now()}`)));
const repeats = Number(option('--repeats', '3'));
const fixture = path.resolve(option('--fixture', path.join(root,'src-tauri/tests/fixtures/english-phrase-quality-v1'))).replace(/\.srt$/, '');
const cues=JSON.parse(fs.readFileSync(`${fixture}.manifest.json`,'utf8')).cues;
const limit = Number(option('--limit', String(cues)));
const profile = option('--profile', 'practical');
if (!['practical', 'strict'].includes(profile)) throw Error('Invalid quality profile');
if (!Number.isInteger(repeats) || repeats < 1 || !Number.isInteger(limit) || limit < 1 || limit > cues) throw Error('Invalid repeats or limit');
const support = path.join(os.homedir(), 'Library/Application Support/com.lexicue.app');
const assets = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/native/gemma/models.json'), 'utf8'));
const target = process.arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin';
const defaultAsset = assets.find(a => a.label === 'E2B' && a.targets.includes(target));
const model = option('--model', path.join(support, `gemma-models/${defaultAsset.id}.${defaultAsset.format}`));
const asset = assets.find(a => path.basename(model) === `${a.id}.${a.format}` && a.targets.includes(target));
if (!asset) throw Error('Use a pinned macOS model filename from src-tauri/native/gemma/models.json');
const runtime = option('--runtime', path.join(root, 'src-tauri/resources/gemma-runtime'));
if (process.platform !== 'darwin') throw Error('This runner signs the macOS native test host; use the Rust test with the documented environment on other platforms.');
if (!fs.existsSync(model) || !fs.existsSync(path.join(runtime, 'liblexicue_gemma.dylib'))) throw Error('Install the pinned model and run npm run prepare:gemma first.');
if (fs.statSync(model).size !== asset.bytes) throw Error('Pinned model file has the wrong size');
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, 'source.json');
execFileSync(process.execPath, ['scripts/evaluate-english-phrases.mjs', '--fixture',fixture,'--export-native', input], { cwd: root, stdio: 'inherit' });
const env = { ...process.env, LINDERA_DICTIONARIES_PATH: path.join(root, 'scripts/cache/lindera') };
const built = execFileSync('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', '--no-run', '--message-format=json'], { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const artifact = built.split('\n').filter(Boolean).map(l => JSON.parse(l)).findLast(r => r.reason === 'compiler-artifact' && r.profile.test && r.executable);
if (!artifact) throw Error('Cargo did not produce a test executable');
const host = path.join(output, 'gemma-quality-host');
fs.copyFileSync(artifact.executable, host);
execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', 'src-tauri/Entitlements.plist', host], { cwd: root, stdio: 'inherit' });
Object.assign(env, {
  LEXICUE_GEMMA_SMOKE_MODEL: model,
  LEXICUE_GEMMA_SMOKE_ASSET: asset.id,
  LEXICUE_GEMMA_SMOKE_LIBRARY: runtime,
  LEXICUE_GEMMA_SMOKE_SUBTITLE: input,
  LEXICUE_GEMMA_SMOKE_REPEATS: String(repeats),
  LEXICUE_GEMMA_SMOKE_LIMIT: String(limit),
  LEXICUE_GEMMA_SMOKE_REPORT_PREFIX: path.join(output, 'run'),
});
const dictionary = option('--dictionary-db', path.join(support, 'lexicue.db'));
if (fs.existsSync(dictionary)) env.LEXICUE_GEMMA_SMOKE_DICTIONARY_DB = dictionary;
console.log(`Reports: ${output}\nRuns: ${repeats}; cues: ${limit}; forced fresh generation on each run.`);
const log = fs.openSync(path.join(output, 'native.log'), 'w');
const run = spawnSync(host, ['gemma4_phrase_quality_benchmark', '--ignored', '--nocapture'], { cwd: root, env, stdio: ['ignore', log, log] });
fs.closeSync(log);
if (run.error || run.status !== 0) throw run.error ?? Error(`Native benchmark failed (${run.status}); inspect ${output}/native.log`);
let failed = false;
for (let n = 0; n < repeats; n++) {
  const params = ['scripts/evaluate-english-phrases.mjs','--fixture',fixture, '--results', path.join(output, `run-${n}.json`), '--output', path.join(output, `score-${n}.json`)];
  if (limit === cues) params.push('--assert', '--profile', profile);
  const score = spawnSync(process.execPath, params, { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(output, `score-${n}.log`), `${score.stdout ?? ''}${score.stderr ?? ''}`);
  failed ||= score.status !== 0;
  const report = JSON.parse(fs.readFileSync(path.join(output, `score-${n}.json`), 'utf8'));
  console.log(JSON.stringify({ run: n, elapsedMs: report.elapsedMs, ...Object.fromEntries(Object.entries(report.overall).filter(([, v]) => !Array.isArray(v))) }));
}
if (failed) process.exitCode = 1;
