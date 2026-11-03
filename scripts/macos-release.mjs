/** macOS public-distribution staging only; never creates a GitHub release/feed.
 * `check` is local/read-only. `build` explicitly signs and uploads to Apple's
 * notary service. `verify` assesses existing artifacts and runs a signed host.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, openSync, readSync, closeSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const need = (condition, message) => { if (!condition) throw Error(message); };
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  // Never echo arguments, credential-bearing environment, or tool error bodies.
  need(!result.error && result.status === 0, `${basename(command)} failed (exit ${result.status ?? 'unavailable'}); no release artifact is approved`);
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function run(command, args, env) {
  console.log(`Running ${basename(command)} stage`);
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  need(!result.error && result.status === 0, `${basename(command)} stage failed; no release artifact is approved`);
}
async function sha(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export function validateVersions(versions) {
  need(versions.length >= 5 && versions.every(value => value === versions[0]), 'Package/lock/Cargo/Tauri versions must agree');
  need(/^\d+\.\d+\.\d+$/.test(versions[0]), 'Public version must be a stable numeric semver');
  const [major, minor, patch] = versions[0].split('.').map(Number);
  need(major > 0 || minor > 4 || minor === 4 && patch > 5, 'Public version must advance beyond already-published 0.4.5');
  return versions[0];
}
export function validateIdentity(identity, team, identities) {
  need(/^[A-Z0-9]{10}$/.test(team ?? ''), 'APPLE_TEAM_ID must identify the intended Developer ID team');
  need(typeof identity === 'string' && identity.startsWith('Developer ID Application: ') && identity.endsWith(` (${team})`), 'APPLE_SIGNING_IDENTITY must be Developer ID Application for the intended team; Apple Development/ad-hoc is not accepted');
  need(identities.split('\n').some(line => line.includes(`"${identity}"`) && !line.includes('CSSMERR')), 'The intended Developer ID Application identity/private key is not available in the signing keychain');
}
export function validateSignature(details, team, runtime = false) {
  need(details.split('\n').some(line => line.startsWith('Authority=Developer ID Application: ') && line.endsWith(` (${team})`)), 'Artifact is not signed by the intended Developer ID Application authority');
  need(details.includes(`TeamIdentifier=${team}\n`), 'Artifact TeamIdentifier mismatch');
  need(/^Timestamp=.+/m.test(details), 'Artifact lacks a secure signing timestamp');
  need(!/Signature=adhoc/i.test(details), 'Ad-hoc artifacts cannot pass the public macOS gate');
  if (runtime) need(/flags=.*\bruntime\b/.test(details), 'Main executable must enable Hardened Runtime');
}
export function validateNotary(result) {
  need(result?.status === 'Accepted' && typeof result.id === 'string' && /^[0-9a-f-]{36}$/i.test(result.id), 'Apple notarization has not returned Accepted with a submission ID');
}
export function releaseEnvironment(env, targetDir) {
  const next = { ...env, CARGO_TARGET_DIR: targetDir, LEXICUE_SLICE_PREVIEW: '0' };
  for (const key of Object.keys(next)) if (key.startsWith('VITE_SLICE_')) next[key] = '0';
  for (const key of ['VITE_SLICE_PREVIEW', 'VITE_SLICE_QA', 'VITE_SLICE_P2', 'VITE_SLICE_P3', 'VITE_SLICE_P4', 'VITE_SLICE_MAC_RELEASE']) next[key] = '0';
  // A caller cannot silently override the reviewed release configuration.
  delete next.TAURI_CONFIG;
  next.LINDERA_DICTIONARIES_PATH ||= join(root, 'scripts/cache/lindera');
  return next;
}
function version() {
  const pkg = json(join(root, 'package.json')), lock = json(join(root, 'package-lock.json'));
  const cargo = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const cargoLock = readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8').match(/\[\[package\]\]\s+name = "lexicue"\s+version = "([^"]+)"/)?.[1];
  const config = json(join(root, 'src-tauri/tauri.conf.json'));
  need(config.identifier === 'com.lexicue.app' && config.productName === 'LexiCue', 'Public bundle identity must be LexiCue/com.lexicue.app');
  return validateVersions([pkg.version, lock.version, lock.packages?.['']?.version, cargo, cargoLock, config.version]);
}
export function validateSyncEndpoint(value) {
  need(typeof value === 'string' && value.length > 0, 'Missing LEXICUE_SYNC_ENDPOINT; configure the real official HTTPS endpoint');
  let url;
  try { url = new URL(value); } catch { throw Error('LEXICUE_SYNC_ENDPOINT must be a valid official HTTPS URL'); }
  const host = url.hostname.toLowerCase();
  need(url.protocol === 'https:' && !url.username && !url.password, 'Official HTTPS sync endpoint required');
  need(!/^(localhost|127\.|0\.|\[::1\])/.test(host) && !/(^|\.)(example\.(com|org|net)|invalid|localhost|test)$/.test(host), 'A real official sync endpoint is required; local/example endpoints do not qualify');
}
export async function readiness(env = process.env) {
  const failures = [], evidence = {};
  const inspect = async (name, fn) => { try { evidence[name] = await fn(); } catch (error) { failures.push({ check: name, reason: error.message }); } };
  await inspect('host', () => { need(process.platform === 'darwin', 'macOS host required'); return 'macOS'; });
  await inspect('versions', version);
  await inspect('identity', () => { const result = capture('security', ['find-identity', '-v', '-p', 'codesigning']); validateIdentity(env.APPLE_SIGNING_IDENTITY, env.APPLE_TEAM_ID, result.stdout); return 'intended Developer ID identity available'; });
  await inspect('notaryConfiguration', () => {
    for (const key of ['APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_PATH']) need(env[key], `Missing ${key}; no private-key content was read or printed`);
    need(/^[0-9a-f-]{36}$/i.test(env.APPLE_API_ISSUER), 'APPLE_API_ISSUER must be the configured issuer UUID');
    const key = statSync(env.APPLE_API_KEY_PATH);
    need(key.isFile() && key.size > 0 && (key.mode & 0o077) === 0, 'API key must be a nonempty private file (0600 or stricter)');
    return 'configured locally; authentication not contacted or verified by check';
  });
  await inspect('tools', () => { for (const tool of ['notarytool', 'stapler', 'clang']) capture('xcrun', ['--find', tool]); return 'notarytool/stapler/clang available'; });
  await inspect('syncEndpoint', () => { validateSyncEndpoint(env.LEXICUE_SYNC_ENDPOINT); return 'HTTPS configured (network not contacted)'; });
  return { mode: 'readiness-only', readyForBuild: failures.length === 0, publicDistributionApproved: false, evidence, failures, note: 'No build, private-key content access, credential validation request, signing, notarization upload, or publication was performed.' };
}
async function inventory(folder) {
  const rows = {};
  const walk = async relative => {
    for (const name of readdirSync(join(folder, relative)).sort()) {
      const rel = join(relative, name), path = join(folder, rel), info = lstatSync(path);
      if (info.isSymbolicLink()) rows[rel] = { kind: 'symlink', mode: info.mode & 0o777, target: readlinkSync(path) };
      else if (info.isDirectory()) await walk(rel);
      else if (info.isFile()) rows[rel] = { kind: 'file', mode: info.mode & 0o777, bytes: info.size, sha256: await sha(path) };
    }
  };
  await walk(''); return rows;
}
function signature(path, env, runtime = false) {
  capture('codesign', ['--verify', '--deep', '--strict', path]);
  const { stdout, stderr } = capture('codesign', ['-d', '--verbose=4', path]);
  validateSignature(stdout + stderr, env.APPLE_TEAM_ID, runtime);
}
function entitlements(path) {
  const raw = capture('codesign', ['-d', '--entitlements', ':-', path]).stdout.trim();
  if (!raw) return {};
  return JSON.parse(capture('plutil', ['-convert', 'json', '-o', '-', '-'], { input: raw }).stdout);
}
function verifyGemma(app, env) {
  // An ad-hoc host cannot test same-Team library validation. Sign this throwaway
  // host with the actual release identity and no library-validation exemption.
  const temp = mkdtempSync(join(tmpdir(), 'lexicue-release-host-'));
  try {
    const manifest = json(join(app, 'Contents/Resources/resources/gemma-runtime/runtime.json'));
    const arch = manifest.target.startsWith('x86_64') ? 'x86_64' : 'arm64';
    const source = join(temp, 'host.c'), host = join(temp, 'host');
    writeFileSync(source, '#include <dlfcn.h>\nint main(int n,char**v){void*h=dlopen(v[1],RTLD_LAZY|RTLD_LOCAL);if(!h)return 1;int(*abi)(void)=dlsym(h,"lx_abi");return !abi||abi()!=1;}\n');
    capture('xcrun', ['clang', '-arch', arch, source, '-o', host]);
    capture('codesign', ['--force', '--sign', env.APPLE_SIGNING_IDENTITY, '--options', 'runtime', '--timestamp', host]);
    capture(host, [join(app, 'Contents/Resources/resources/gemma-runtime/liblexicue_gemma.dylib')]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export async function verifyArtifacts(app, dmg, env, expectedVersion) {
  need(process.platform === 'darwin', 'Artifact verification requires macOS');
  const identities = capture('security', ['find-identity', '-v', '-p', 'codesigning']).stdout;
  validateIdentity(env.APPLE_SIGNING_IDENTITY, env.APPLE_TEAM_ID, identities);
  need(app.endsWith('.app') && dmg.endsWith('.dmg'), 'Explicit .app and .dmg paths required');
  const info = JSON.parse(capture('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]).stdout);
  need(info.CFBundleIdentifier === 'com.lexicue.app' && info.CFBundleShortVersionString === expectedVersion, 'Artifact identifier/version does not match reviewed release');
  signature(app, env, true);
  const permissions = entitlements(app);
  need(!permissions['com.apple.security.get-task-allow'], 'Debug entitlement present');
  need(!permissions['com.apple.security.cs.disable-library-validation'], 'Public release must not inherit the ad-hoc library-validation exemption');
  const files = await inventory(app), macho = [];
  const magic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
  for (const [name, row] of Object.entries(files)) {
    if (row.kind !== 'file' || row.bytes < 4) continue;
    const path = join(app, name);
    const descriptor = openSync(path, 'r'), header = Buffer.alloc(4);
    try { readSync(descriptor, header, 0, 4, 0); } finally { closeSync(descriptor); }
    if (!magic.has(header.toString('hex'))) continue;
    signature(path, env);
    const rights = entitlements(path);
    need(!rights['com.apple.security.get-task-allow'], 'A nested executable has a debug entitlement');
    macho.push(name);
  }
  need(macho.length > 0, 'No signed Mach-O executables found');
  capture('xcrun', ['stapler', 'validate', app]);
  capture('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  signature(dmg, env);
  capture('hdiutil', ['verify', dmg]);
  capture('xcrun', ['stapler', 'validate', dmg]);
  capture('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
  const mount = mkdtempSync(join(tmpdir(), 'lexicue-release-dmg-'));
  let attached = false;
  try {
    capture('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]); attached = true;
    const inside = join(mount, basename(app));
    need(JSON.stringify(await inventory(inside)) === JSON.stringify(files), 'DMG app differs from verified app (bytes/modes/symlink targets)');
    capture('xcrun', ['stapler', 'validate', inside]);
    capture('spctl', ['--assess', '--type', 'execute', '--verbose=4', inside]);
  } finally {
    if (attached) capture('hdiutil', ['detach', mount]);
    rmSync(mount, { recursive: true, force: true });
  }
  verifyGemma(app, env);
  return { version: expectedVersion, app, dmg, appFiles: files, machoFiles: macho, dmgSHA256: await sha(dmg), codesign: 'Developer ID / intended Team / secure timestamps', hardenedRuntime: true, stapledTickets: ['app', 'dmg'], gatekeeper: ['app', 'dmg'], dmgContainsVerifiedApp: true, sameTeamGemmaHost: 'ABI 1 loaded', published: false };
}
async function build(env) {
  const preflight = await readiness(env);
  if (!preflight.readyForBuild) { console.log(JSON.stringify(preflight, null, 2)); throw Error('macOS release build blocked by readiness checks'); }
  need(capture('git', ['status', '--porcelain', '--untracked-files=normal']).stdout.trim() === '', 'Release build requires a clean reviewed checkout');
  const commit = capture('git', ['rev-parse', 'HEAD']).stdout.trim();
  const target = join(root, 'src-tauri/target/macos-public');
  need(!existsSync(join(target, 'release/bundle')), 'Release output already exists; retain it and use a fresh worktree for another release');
  const buildEnv = releaseEnvironment(env, target), releaseVersion = preflight.evidence.versions;
  run(process.execPath, ['--test', 'scripts/macos-release.test.mjs'], buildEnv);
  run('npm', ['run', 'check:release:tests'], buildEnv);
  const temp = mkdtempSync(join(tmpdir(), 'lexicue-release-config-'));
  try {
    const config = join(temp, 'config.json');
    writeFileSync(config, JSON.stringify({ bundle: { createUpdaterArtifacts: false, macOS: { signingIdentity: env.APPLE_SIGNING_IDENTITY, hardenedRuntime: true, entitlements: join(root, 'scripts/macos-release.entitlements.plist') } } }));
    run('npm', ['run', 'tauri', '--', 'build', '--bundles', 'app,dmg', '--config', config], buildEnv);
    const app = join(target, 'release/bundle/macos/LexiCue.app');
    const dmgs = readdirSync(join(target, 'release/bundle/dmg')).filter(name => name.endsWith('.dmg'));
    need(dmgs.length === 1, 'Expected exactly one new release DMG');
    const dmg = join(target, 'release/bundle/dmg', dmgs[0]);
    // Tauri notarizes/staples the app. Independently sign and notarize the final
    // outer container so offline distribution does not depend on ticket fetch.
    capture('codesign', ['--force', '--sign', env.APPLE_SIGNING_IDENTITY, '--timestamp', dmg]);
    const result = JSON.parse(capture('xcrun', ['notarytool', 'submit', dmg, '--key', env.APPLE_API_KEY_PATH, '--key-id', env.APPLE_API_KEY, '--issuer', env.APPLE_API_ISSUER, '--wait', '--output-format', 'json']).stdout);
    validateNotary(result);
    capture('xcrun', ['stapler', 'staple', dmg]);
    const verified = await verifyArtifacts(app, dmg, buildEnv, releaseVersion);
    need(capture('git', ['rev-parse', 'HEAD']).stdout.trim() === commit && capture('git', ['status', '--porcelain', '--untracked-files=normal']).stdout.trim() === '', 'Source changed during release build');
    const report = { recordedAtUTC: new Date().toISOString(), codeCommit: commit, scope: 'Verified macOS installer staging, no public release or updater feed', preflight, notary: { id: result.id, status: result.status }, ...verified };
    writeFileSync(join(target, 'macos-release-verification.json'), JSON.stringify(report, null, 2));
    console.log(`Verified macOS ${releaseVersion} installer artifacts staged. No GitHub release, tag, or updater feed was created.`);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
async function main() {
  const [mode = 'check', ...args] = process.argv.slice(2);
  if (mode === 'check' && args.length === 0) { const result = await readiness(); console.log(JSON.stringify(result, null, 2)); if (!result.readyForBuild) process.exitCode = 1; }
  else if (mode === 'build' && args.length === 0) await build(process.env);
  else if (mode === 'verify' && args.length === 2) console.log(JSON.stringify(await verifyArtifacts(resolve(args[0]), resolve(args[1]), process.env, version()), null, 2));
  else throw Error('Usage: node scripts/macos-release.mjs [check|build|verify /path/LexiCue.app /path/LexiCue.dmg]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
