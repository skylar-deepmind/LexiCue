import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'src-tauri/native/gemma');
const lock = JSON.parse(readFileSync(join(source, 'runtimes.json'), 'utf8'));
const args = process.argv.slice(2);
const target = args[0] === '--target' ? args[1] : process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || ({ darwin: { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' }, win32: { x64: 'x86_64-pc-windows-msvc' } }[process.platform]?.[process.arch]);
const platforms = { 'aarch64-apple-darwin': 'macos_arm64', 'x86_64-apple-darwin': 'macos_x86_64', 'x86_64-pc-windows-msvc': 'windows_x86_64', 'aarch64-linux-android': 'android_arm64' };
const platform = platforms[target];
if (!platform) {
  if (process.platform === 'linux' && (!target || target.includes('unknown-linux'))) {
    console.log('Embedded Gemma is unavailable on Linux; building the cloud-capable application.');
    process.exit(0);
  }
  throw new Error(`Embedded Gemma does not support target ${target}`);
}
const cache = join(root, 'scripts/cache/gemma-native');
mkdirSync(cache, { recursive: true });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed (${result.status})`);
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function archive(info, destination) {
  const path = join(cache, info.archive);
  if (!existsSync(path) || digest(path) !== info.sha256) {
    const temp = `${path}.part`;
    run('curl', ['--fail', '--location', '--retry', '2', '--output', temp, info.url]);
    if (digest(temp) !== info.sha256) throw new Error(`Native archive checksum mismatch: ${info.archive}`);
    copyFileSync(temp, path); rmSync(temp);
  }
  if (!existsSync(destination)) {
    mkdirSync(destination, { recursive: true });
    try {
      // CMake/libarchive handles both ZIP and tar.gz on every supported host.
      // GNU tar on Android's Ubuntu runner cannot extract the LiteRT ZIP.
      run('cmake', ['-E', 'tar', 'xf', path], destination);
    } catch (error) {
      // A partial directory must not be mistaken for a usable cached archive.
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  }
}
const intel = platform === 'macos_x86_64';
const output = join(cache, 'runtime', target);
const build = join(cache, `build-${target}`);
const definitions = ['-DCMAKE_BUILD_TYPE=Release'];
if (platform.startsWith('macos')) definitions.push('-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0');
let engine;
if (intel) {
  archive(lock.llama, join(cache, 'llama-source'));
  definitions.push(`-DLX_LLAMA_SOURCE=${join(cache, 'llama-source', `llama.cpp-${lock.llama.version}`)}`, '-DCMAKE_OSX_ARCHITECTURES=x86_64');
  engine = lock.llama;
} else {
  const unpacked = join(cache, 'c-api'); archive(lock.litert, unpacked);
  const library = join(unpacked, 'lib', platform, platform === 'windows_x86_64' ? 'lib/litert-lm.lib' : `liblitert-lm.${platform === 'macos_arm64' ? 'dylib' : 'so'}`);
  definitions.push(`-DLX_LITERT_INCLUDE=${join(unpacked, 'include')}`, `-DLX_LITERT_LIBRARY=${library}`);
  if (platform === 'macos_arm64') definitions.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
  engine = lock.litert;
}
if (platform === 'android_arm64') {
  const ndk = process.env.NDK_HOME || process.env.ANDROID_NDK_HOME;
  if (!ndk) throw new Error('Set NDK_HOME before preparing Android Gemma');
  const host = readdirSync(resolve(ndk, 'toolchains/llvm/prebuilt'))[0];
  process.env.LEXICUE_ANDROID_CXX = resolve(ndk, 'toolchains/llvm/prebuilt', host, 'sysroot/usr/lib/aarch64-linux-android/libc++_shared.so');
  definitions.push(`-DCMAKE_TOOLCHAIN_FILE=${resolve(ndk, 'build/cmake/android.toolchain.cmake')}`, '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-28', '-DANDROID_STL=c++_shared');
}
run('cmake', ['-S', source, '-B', build, ...definitions]);
run('cmake', ['--build', build, '--config', 'Release', '--parallel', '4']);
rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
run('cmake', ['--install', build, '--config', 'Release', '--prefix', output]);
// llama's subproject installs SDKs/tools too. Only the bridge is distributed.
if (intel) {
  for (const name of readdirSync(output)) if (name !== 'liblexicue_gemma.dylib') rmSync(join(output, name), { recursive: true, force: true });
}
if (!intel) {
  const libraryDir = join(cache, 'c-api/lib', platform);
  if (platform === 'windows_x86_64') copyFileSync(join(libraryDir, 'bin/litert-lm.dll'), join(output, 'litert-lm.dll'));
  else copyFileSync(join(libraryDir, `liblitert-lm.${platform === 'macos_arm64' ? 'dylib' : 'so'}`), join(output, `liblitert-lm.${platform === 'macos_arm64' ? 'dylib' : 'so'}`));
  cpSync(join(cache, 'c-api/licenses'), join(output, 'licenses'), { recursive: true });
  copyFileSync(join(cache, 'c-api/LICENSE'), join(output, 'LICENSE-LiteRT-LM'));
} else copyFileSync(join(cache, 'llama-source', `llama.cpp-${lock.llama.version}`, 'LICENSE'), join(output, 'LICENSE-llama.cpp'));
copyFileSync(join(source, 'NOTICE.md'), join(output, 'NOTICE.md'));
if (platform.startsWith('macos')) {
  if (!intel) {
    // The official macOS C archive retains a .so install name; normalize it
    // so the loader resolves the adjacent bundled dylib on a clean machine.
    run('install_name_tool', ['-change', '@rpath/liblitert-lm.so', '@loader_path/liblitert-lm.dylib', join(output, 'liblexicue_gemma.dylib')]);
    run('install_name_tool', ['-id', '@loader_path/liblitert-lm.dylib', join(output, 'liblitert-lm.dylib')]);
  }
  for (const file of readdirSync(output).filter(name => name.endsWith('.dylib'))) run('codesign', ['--force', '--sign', '-', join(output, file)]);
}
if (platform === 'android_arm64') {
  copyFileSync(process.env.LEXICUE_ANDROID_CXX, join(output, 'libc++_shared.so'));
  const ndk = process.env.NDK_HOME || process.env.ANDROID_NDK_HOME;
  const host = readdirSync(resolve(ndk, 'toolchains/llvm/prebuilt'))[0];
  const strip = resolve(ndk, 'toolchains/llvm/prebuilt', host, 'bin/llvm-strip');
  for (const name of readdirSync(output).filter(name => name.endsWith('.so'))) run(strip, ['--strip-unneeded', join(output, name)]);
}
function writable(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    chmodSync(path, entry.isDirectory() ? 0o755 : 0o644);
    if (entry.isDirectory()) writable(path);
  }
}
writable(output);
writeFileSync(join(output, 'runtime.json'), JSON.stringify({ abi: 1, target, engine: intel ? 'llama' : 'litert', version: engine.version, files: readdirSync(output).filter(name => /\.(so|dll|dylib)$/.test(name)).map(name => ({ name, sha256: digest(join(output, name)) })) }, null, 2));
if (platform !== 'android_arm64' && !args.includes('--cache-only')) {
  const resources = join(root, 'src-tauri/resources/gemma-runtime');
  rmSync(resources, { recursive: true, force: true }); cpSync(output, resources, { recursive: true }); writeFileSync(join(resources, '.gitkeep'), '');
}
console.log(`Embedded Gemma prepared for ${target}; model weights are not bundled.`);
