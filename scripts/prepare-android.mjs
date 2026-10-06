import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = join(root, 'src-tauri/gen/android');
if (!existsSync(join(project, 'app/build.gradle.kts'))) {
  throw new Error('Generate the Android project first: npx tauri android init --ci --skip-targets-install');
}
for (const [source, destination] of [
  ['MainActivity.kt', 'com/lexicue/app/MainActivity.kt'],
  ['Keyring.kt', 'io/crates/keyring/Keyring.kt'],
]) {
  const target = join(project, 'app/src/main/java', destination);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, 'src-tauri/android-template', source), target);
}
const icons = join(root, 'src-tauri/icons/android');
const resources = join(project, 'app/src/main/res');
cpSync(icons, resources, { recursive: true });
function verifyIcons(directory, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) verifyIcons(join(directory, entry.name), path);
    else if (!readFileSync(join(icons, path)).equals(readFileSync(join(resources, path)))) {
      throw new Error(`Android icon was not copied correctly: ${path}`);
    }
  }
}
verifyIcons(icons);
for (const icon of [
  'mipmap-anydpi-v26/ic_launcher.xml',
  'mipmap-xxxhdpi/ic_launcher.png',
  'mipmap-xxxhdpi/ic_launcher_foreground.png',
  'mipmap-xxxhdpi/ic_launcher_round.png',
]) {
  if (!existsSync(join(resources, icon))) throw new Error(`Required Android icon missing: ${icon}`);
}
console.log('Android activity, credential initialization, and launcher icons prepared and verified.');

const native = spawnSync(process.execPath, [join(root, 'scripts/prepare-gemma.mjs'), '--target', 'aarch64-linux-android'], { stdio: 'inherit' });
if (native.error || native.status !== 0) throw native.error || new Error('Android Gemma native preparation failed');
// Tauri resource copies do not remove assets from earlier builds.
rmSync(join(project, 'app/src/main/assets/resources/gemma-runtime'), { recursive: true, force: true });
const runtime = join(root, 'scripts/cache/gemma-native/runtime/aarch64-linux-android');
const jni = join(project, 'app/src/main/jniLibs/arm64-v8a');
mkdirSync(jni, { recursive: true });
for (const name of readdirSync(runtime).filter(name => name.endsWith('.so'))) copyFileSync(join(runtime, name), join(jni, name));
cpSync(runtime, join(project, 'app/src/main/assets/gemma-runtime'), { recursive: true, filter: path => !path.endsWith('.so') });
const gradle = join(project, 'app/build.gradle.kts');
writeFileSync(gradle, readFileSync(gradle, 'utf8').replace(/minSdk\s*=\s*\d+/, 'minSdk = 28'));
