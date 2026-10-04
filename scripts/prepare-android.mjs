import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
