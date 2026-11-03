import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateVersions, validateIdentity, validateSignature, validateNotary, releaseEnvironment, validateSyncEndpoint } from './macos-release.mjs';

const team = 'AB12345678';
const identity = `Developer ID Application: Example (${team})`;
const signature = `Executable=/tmp/LexiCue\nCodeDirectory v=20500 flags=0x10000(runtime) hashes=12+5\nAuthority=${identity}\nTeamIdentifier=${team}\nTimestamp=Nov 1, 2026 at 12:00:00\n`;
test('public version advances consistently across package, Cargo, config and locks', () => {
  assert.equal(validateVersions(Array(6).fill('0.4.6')), '0.4.6');
  for (const versions of [Array(6).fill('0.4.5'), Array(6).fill('0.4.6-beta.1'), ['0.4.6', '0.4.7', ...Array(4).fill('0.4.6')]]) assert.throws(() => validateVersions(versions));
});
test('available Developer ID must match the intended team', () => {
  validateIdentity(identity, team, `1) 0123 "${identity}"`);
  for (const supplied of ['-', `Apple Development: Example (${team})`, 'Developer ID Application: Example (OTHERTEAM1)']) assert.throws(() => validateIdentity(supplied, team, `"${supplied}"`));
  assert.throws(() => validateIdentity(identity, team, '0 valid identities found'));
  assert.throws(() => validateIdentity(identity, team, `"${identity}" (CSSMERR_TP_CERT_EXPIRED)`));
});
test('artifact authority, team, timestamp and main runtime are all enforced', () => {
  validateSignature(signature, team, true);
  for (const bad of [signature.replace(identity, 'Apple Development: Example'), signature.replace(`TeamIdentifier=${team}`, 'TeamIdentifier=OTHERTEAM1'), signature.replace(/^Timestamp=.*\n/m, ''), signature.replace('flags=0x10000(runtime)', 'flags=0x0(none)'), `${signature}Signature=adhoc\n`]) assert.throws(() => validateSignature(bad, team, true));
});
test('notarization must be Accepted, with a submission identifier', () => {
  validateNotary({ status: 'Accepted', id: '12345678-1234-1234-1234-123456789abc' });
  for (const result of [{ status: 'In Progress', id: '12345678-1234-1234-1234-123456789abc' }, { status: 'Invalid' }, { status: 'Accepted', id: '' }]) assert.throws(() => validateNotary(result));
});
test('public build overrides candidate flags and caller Tauri config', () => {
  const original = { VITE_SLICE_PREVIEW: '1', VITE_SLICE_MAC_RELEASE: '1', VITE_SLICE_FUTURE: '1', LEXICUE_SLICE_PREVIEW: '1', TAURI_CONFIG: '{"identifier":"wrong"}', CARGO_TARGET_DIR: '/old' };
  const clean = releaseEnvironment(original, '/isolated');
  for (const key of ['VITE_SLICE_PREVIEW', 'VITE_SLICE_MAC_RELEASE', 'VITE_SLICE_FUTURE', 'VITE_SLICE_QA', 'LEXICUE_SLICE_PREVIEW']) assert.equal(clean[key], '0');
  assert.equal(clean.CARGO_TARGET_DIR, '/isolated');
  assert.equal(clean.TAURI_CONFIG, undefined);
  assert.equal(original.VITE_SLICE_PREVIEW, '1');
});
test('endpoint configuration rejects missing, insecure, local and placeholder URLs', () => {
  validateSyncEndpoint('https://sync.lexicue.app');
  for (const url of ['', 'http://sync.lexicue.app', 'https://localhost:8443', 'https://127.0.0.1', 'https://example.com', 'https://sync.invalid', 'https://user:secret@sync.lexicue.app']) assert.throws(() => validateSyncEndpoint(url));
});
test('missing credentials block explicit build before tests, signing or uploading', () => {
  const env = { ...process.env, APPLE_SIGNING_IDENTITY: '', APPLE_TEAM_ID: '', APPLE_API_ISSUER: '', APPLE_API_KEY: '', APPLE_API_KEY_PATH: '', LEXICUE_SYNC_ENDPOINT: '' };
  const result = spawnSync(process.execPath, ['scripts/macos-release.mjs', 'build'], { cwd: new URL('../', import.meta.url), encoding: 'utf8', env });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"readyForBuild": false/);
  assert.match(result.stderr, /blocked by readiness/);
  assert.doesNotMatch(result.stdout, /Running npm stage/);
  assert.match(result.stdout, /No build, private-key content access/);
});
test('general macOS installer job cannot publish; other platforms keep separate jobs', () => {
  const workflow = readFileSync(new URL('../.github/workflows/build-installers.yml', import.meta.url), 'utf8');
  const mac = workflow.split('  macos:\n')[1].split('  windows:\n')[0];
  assert.match(mac, /contents: read/);
  assert.doesNotMatch(mac, /tauri-apps\/tauri-action|contents: write|tagName:|GITHUB_TOKEN:/);
  assert.match(mac, /createUpdaterArtifacts.*false/);
  assert.ok(mac.indexOf('Verify packaged Gemma') < mac.indexOf('uses: actions/upload-artifact'));
});
