import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Unlike an unsigned Python/Rust test, this host exercises dyld under the
// application's Hardened Runtime and entitlements, including LiteRT dependencies.
if (process.platform !== 'darwin') process.exit(0);
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--app')) {
  throw new Error('Usage: node scripts/check-gemma-macos-signing.mjs [--app /path/LexiCue.app]');
}
const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const app = args.length ? resolve(args[1]) : null;
const runtime = app ? join(app, 'Contents/Resources/resources/gemma-runtime')
  : join(root, 'src-tauri/resources/gemma-runtime');
const manifest = JSON.parse(readFileSync(join(runtime, 'runtime.json'), 'utf8'));
const architecture = manifest.target.startsWith('x86_64') ? 'x86_64' : 'arm64';
const directory = mkdtempSync(join(tmpdir(), 'lexicue-signing-'));
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const source = join(directory, 'host.c');
  const host = join(directory, 'host');
  writeFileSync(source, `#include <dlfcn.h>
#include <stdio.h>
int main(int argc, char **argv) {
  void *library = dlopen(argv[1], RTLD_LAZY | RTLD_LOCAL);
  if (!library) { fprintf(stderr, "%s\\n", dlerror()); return 1; }
  int (*abi)(void) = dlsym(library, "lx_abi");
  if (!abi || abi() != 1) return 2;
  puts("Signed Gemma host: ABI 1, bridge and dependencies loaded");
  return 0;
}
`);
  let entitlements;
  if (app) {
    const contents = run('codesign', ['-d', '--entitlements', ':-', app]).trim();
    if (contents) {
      entitlements = join(directory, 'Entitlements.plist');
      writeFileSync(entitlements, contents);
    }
  } else {
    entitlements = join(root, 'src-tauri', config.bundle.macOS.entitlements);
  }
  run('clang', ['-arch', architecture, source, '-o', host]);
  const signing = ['--force', '--sign', '-'];
  if (config.bundle.macOS.hardenedRuntime !== false) signing.push('--options', 'runtime');
  if (entitlements) signing.push('--entitlements', entitlements);
  signing.push(host);
  run('codesign', signing);
  process.stdout.write(run(host, [join(runtime, 'liblexicue_gemma.dylib')]));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
