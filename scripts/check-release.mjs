import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const localEnv = join(root, '.env.local');
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const toolchain = JSON.parse(readFileSync(join(root, 'scripts/android-toolchain.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--android-only')) throw new Error('Usage: npm run check:release -- [--android-only]');
const env = { ...process.env };
env.LINDERA_DICTIONARIES_PATH ||= join(root, 'scripts/cache/lindera');
// Java does not read the HTTP proxy environment used by npm/Cargo. Carry it
// into Gradle for local dependency downloads, preserving explicit Gradle settings.
const gradleProperties = join(homedir(), '.gradle/gradle.properties');
const hasGradleProxy = /proxyHost/.test(env.GRADLE_OPTS ?? '')
  || (existsSync(gradleProperties) && /proxyHost/.test(readFileSync(gradleProperties, 'utf8')));
const proxyUrl = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
let gradleProxy;
if (proxyUrl && !hasGradleProxy) {
  const proxy = new URL(proxyUrl);
  if (proxy.protocol === 'http:' && !proxy.username && !proxy.password) {
    gradleProxy = proxy;
    const options = ['http', 'https'].flatMap(protocol => [
      `-D${protocol}.proxyHost=${proxy.hostname}`,
      `-D${protocol}.proxyPort=${proxy.port || '80'}`,
    ]);
    env.GRADLE_OPTS = [env.GRADLE_OPTS, ...options].filter(Boolean).join(' ');
  }
}
if (!env.LEXICUE_SYNC_ENDPOINT?.startsWith('https://')) {
  throw new Error('Set LEXICUE_SYNC_ENDPOINT to the same HTTPS endpoint configured in Actions. See docs/local-build-validation.md.');
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function run(command, args, cwd = root) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function required(path, message) {
  if (!existsSync(path)) throw new Error(`${message}: ${path}. See docs/local-build-validation.md.`);
}
env.ANDROID_HOME ||= process.platform === 'darwin'
  ? join(homedir(), 'Library/Android/sdk')
  : process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk')
    : join(homedir(), 'Android/Sdk');
env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
// Pin the same NDK as Actions; selecting the newest installed version can hide drift.
env.NDK_HOME = join(env.ANDROID_HOME, 'ndk', toolchain.ndkVersion);
if (process.platform === 'darwin') {
  const java = spawnSync('/usr/libexec/java_home', ['-v', String(toolchain.javaMajor)], { encoding: 'utf8' });
  if (java.status !== 0) throw new Error(`Java ${toolchain.javaMajor} is required. See docs/local-build-validation.md.`);
  env.JAVA_HOME = java.stdout.trim();
}
required(join(env.NDK_HOME, 'source.properties'), `Install Android NDK ${toolchain.ndkVersion}`);
required(join(env.ANDROID_HOME, 'platforms', `android-${toolchain.sdkApi}`, 'android.jar'), 'Install the Android SDK platform');
required(join(env.ANDROID_HOME, 'build-tools', toolchain.buildTools), 'Install Android SDK build tools');
const ndkProperties = readFileSync(join(env.NDK_HOME, 'source.properties'), 'utf8');
if (!ndkProperties.includes(`Pkg.Revision = ${toolchain.ndkVersion}`)) throw new Error('Android NDK version mismatch');
if (!env.JAVA_HOME) throw new Error(`Set JAVA_HOME to a Java ${toolchain.javaMajor} installation`);
const javaExecutable = join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const javaVersion = spawnSync(javaExecutable, ['-version'], { encoding: 'utf8', env });
if (javaVersion.status !== 0 || !new RegExp(`version "${toolchain.javaMajor}\\.`).test(javaVersion.stderr)) {
  throw new Error(`Java ${toolchain.javaMajor} is required`);
}
const targets = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8', env });
if (targets.status !== 0 || !targets.stdout.includes('aarch64-linux-android')) {
  throw new Error('Install the Rust target: rustup target add aarch64-linux-android');
}
console.log(`Android toolchain: Java ${toolchain.javaMajor}, SDK ${toolchain.sdkApi}, NDK ${toolchain.ndkVersion}`);
// Match Actions rather than whatever compatible versions happen to be installed.
run(npm, ['ci']);
if (!args.includes('--android-only')) {
  run(npm, ['run', 'check:release:tests']);
  run(npm, ['run', 'tauri', 'build', '--', '--no-bundle', '--config', '{"build":{"beforeBuildCommand":""}}']);
}
run(npx, ['tauri', 'android', 'init', '--ci', '--skip-targets-install']);
run(process.execPath, ['scripts/prepare-android.mjs']);
if (gradleProxy) {
  const propertiesPath = join(root, 'src-tauri/gen/android/gradle.properties');
  const properties = readFileSync(propertiesPath, 'utf8');
  if (!/systemProp\.(http|https)\.proxyHost\s*=/.test(properties)) {
    const proxyProperties = ['http', 'https'].flatMap(protocol => [
      `systemProp.${protocol}.proxyHost=${gradleProxy.hostname}`,
      `systemProp.${protocol}.proxyPort=${gradleProxy.port || '80'}`,
    ]);
    appendFileSync(propertiesPath, `\n${proxyProperties.join('\n')}\n`);
  }
}
// The release build includes Rust, Kotlin, Android resources and APK packaging.
// It remains unsigned locally; release signing stays in Actions.
run(npx, ['tauri', 'android', 'build', '--ci', '--apk', '--target', 'aarch64']);
console.log('\nLocal release checks passed, including the Android release APK build.');
