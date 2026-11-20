import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tauri = join(root, 'src-tauri');
const storeConfig = join(tauri, 'tauri.mac-app-store.conf.json');
const { identifier } = JSON.parse(readFileSync(storeConfig, 'utf8'));

const required = (name) => {
  if (!process.env[name]) throw new Error(`Set ${name}`);
  return process.env[name];
};
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const run = (bin, args, options = {}) =>
  execFileSync(bin, args, { cwd: root, encoding: 'utf8', ...options });
const plist = (path) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path]));
const plistFrom = (input) =>
  JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { input }));

const profilePath = resolve(required('LEXICUE_MAC_APP_STORE_PROFILE'));
const installerIdentity = required('LEXICUE_MAC_APP_STORE_INSTALLER_IDENTITY');
const signingIdentity = required('APPLE_SIGNING_IDENTITY');
const buildNumber = required('LEXICUE_MAC_APP_STORE_BUILD_NUMBER');
const targetDir = required('CARGO_TARGET_DIR');
check(process.platform === 'darwin', 'Build on macOS');
check(/^[1-9][0-9]*$/.test(buildNumber), 'Use a sequential positive integer build number');
check(isAbsolute(targetDir), 'Use an absolute CARGO_TARGET_DIR');
check(signingIdentity.startsWith('Apple Distribution: '), 'Use an Apple Distribution signing identity');
check(installerIdentity.startsWith('3rd Party Mac Developer Installer: '), 'Use a Mac Installer Distribution identity');

const profile = plistFrom(run('security', ['cms', '-D', '-i', profilePath]));
const [team] = profile.TeamIdentifier ?? [];
const appIdentifier = `${team}.${identifier}`;
check(team && profile.Entitlements?.['com.apple.application-identifier'] === appIdentifier, 'Provisioning profile must match the LexiCue store Bundle ID');
check(Date.parse(profile.ExpirationDate) > Date.now() && !profile.ProvisionedDevices, 'Use a current Mac App Store distribution profile');
check(signingIdentity.endsWith(`(${team})`) && installerIdentity.endsWith(`(${team})`), 'Both signing identities must match the profile team');

const temp = mkdtempSync(join(tmpdir(), 'lexicue-mac-app-store-'));
try {
  const rights = {
    ...plist(join(tauri, 'MacAppStore.entitlements.plist')),
    'com.apple.application-identifier': appIdentifier,
    'com.apple.developer.team-identifier': team,
  };
  const rightsPath = join(temp, 'entitlements.plist');
  const jsonPath = join(temp, 'entitlements.json');
  writeFileSync(jsonPath, JSON.stringify(rights));
  run('plutil', ['-convert', 'xml1', '-o', rightsPath, jsonPath]);
  const overrides = join(temp, 'signing.json');
  writeFileSync(overrides, JSON.stringify({
    bundle: {
      macOS: {
        bundleVersion: buildNumber,
        signingIdentity,
        entitlements: rightsPath,
        files: {
          'embedded.provisionprofile': profilePath,
          'Resources/PrivacyInfo.xcprivacy': join(tauri, 'PrivacyInfo.xcprivacy'),
        },
      },
    },
  }));
  const env = { ...process.env };
  delete env.TAURI_CONFIG;
  delete env.APPLE_API_KEY;
  delete env.APPLE_API_KEY_PATH;
  delete env.APPLE_API_ISSUER;
  delete env.APPLE_ID;
  delete env.APPLE_PASSWORD;
  for (const key of Object.keys(env)) if (/^(VITE|LEXICUE)_SLICE_/.test(key)) delete env[key];
  const build = spawnSync('npm', ['run', 'tauri', '--', 'build', '--bundles', 'app',
    '--target', 'aarch64-apple-darwin', '--config', storeConfig, '--config', overrides],
  { cwd: root, env, stdio: 'inherit' });
  if (build.error) throw build.error;
  check(build.status === 0, 'Tauri Mac App Store build failed');
  const bundle = join(targetDir, 'aarch64-apple-darwin', 'release', 'bundle');
  const app = join(bundle, 'macos', 'LexiCue.app');
  const info = plist(join(app, 'Contents/Info.plist'));
  check(info.CFBundleIdentifier === identifier && info.CFBundleVersion === buildNumber, 'Unexpected Mac app identity or build number');
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const signedRights = plistFrom(run('codesign', ['-d', '--entitlements', '-', app]));
  check(Object.entries(rights).every(([key, value]) => signedRights[key] === value), 'Signed app entitlements do not match the store configuration');
  check(!signedRights['com.apple.security.get-task-allow'] && !signedRights['com.apple.security.cs.disable-library-validation'], 'The app has a development entitlement');
  check(existsSync(join(app, 'Contents/Resources/PrivacyInfo.xcprivacy')), 'Missing privacy manifest');
  const output = join(bundle, 'app-store');
  mkdirSync(output, { recursive: true });
  const pkg = join(output, `LexiCue_${info.CFBundleShortVersionString}_${buildNumber}_arm64.pkg`);
  run('productbuild', ['--component', app, '/Applications', '--sign', installerIdentity, pkg], { stdio: 'inherit' });
  run('pkgutil', ['--check-signature', pkg], { stdio: 'inherit' });
  console.log(pkg);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
