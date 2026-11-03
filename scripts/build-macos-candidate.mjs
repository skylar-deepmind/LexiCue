/** Local macOS release-readiness candidate only. Never publishes or changes the installed app. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (process.platform !== 'darwin' || args.some(arg => arg !== '--build-only')) {
  throw new Error('Usage on macOS: node scripts/build-macos-candidate.mjs [--build-only]');
}
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const version = readJson('package.json').version;
const cargoVersion = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const config = readJson('src-tauri/tauri.conf.json');
const candidate = readJson('src-tauri/tauri.mac-release-candidate.conf.json');
if (version !== cargoVersion || version !== config.version) throw new Error('Package/Cargo/Tauri version mismatch');
if (candidate.identifier !== 'com.lexicue.mac-release-candidate' || candidate.bundle.createUpdaterArtifacts !== false) {
  throw new Error('Candidate identity and updater isolation are required');
}
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) if (key.startsWith('VITE_SLICE_') || key.startsWith('APPLE_') || key.startsWith('TAURI_SIGNING_') || key === 'TAURI_CONFIG' || key === 'LEXICUE_SLICE_PREVIEW') delete cleanEnv[key];
cleanEnv.CARGO_TARGET_DIR = join(root, 'src-tauri/target');
cleanEnv.LINDERA_DICTIONARIES_PATH ||= join(root, 'scripts/cache/lindera');
function run(command, parameters, env) {
  const result = spawnSync(command, parameters, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!args.includes('--build-only')) run('npm', ['run', 'check:release:tests'], cleanEnv);
const candidateEnv = { ...cleanEnv, APPLE_SIGNING_IDENTITY: '-', LEXICUE_SLICE_PREVIEW: '1', VITE_SLICE_PREVIEW: '1', VITE_SLICE_P4: '1', VITE_SLICE_MAC_RELEASE: '1', VITE_SLICE_QA: '0', VITE_SLICE_P2: '0', VITE_SLICE_P3: '0', LEXICUE_SYNC_ENDPOINT: '' };
const source = { codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), worktreeStatus: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(), startedAtUTC: new Date().toISOString() };
run('npm', ['run', 'tauri', '--', 'build', '--bundles', 'app,dmg', '--config', 'src-tauri/tauri.mac-release-candidate.conf.json'], candidateEnv);
const app = join(root, 'src-tauri/target/release/bundle/macos/LexiCue macOS Candidate.app');
run('codesign', ['--verify', '--deep', '--strict', app], candidateEnv);
run(process.execPath, ['scripts/check-gemma-macos-signing.mjs', '--app', app], candidateEnv);
writeFileSync(join(root, 'src-tauri/target/mac-release-build-receipt.json'), JSON.stringify({ ...source, completedAtUTC: new Date().toISOString() }, null, 2) + '\n');
console.log(`Local macOS ${version} candidate built and verified. No publication or notarization performed.`);
