#!/usr/bin/env node
// Link the reviewed local resources for native development; never touch user data.
import { readFile, realpath, mkdir, symlink, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-longman-local.mjs /absolute/longman-local-package');
const packageRoot = await realpath(source);
const textRoot = path.join(packageRoot, 'text-v1');
const manifest = JSON.parse(await readFile(path.join(textRoot, 'manifest.json'), 'utf8'));
if (manifest.schema_version !== 1 || !manifest.data_release) throw new Error('Unsupported Longman text manifest');
await lstat(path.join(textRoot, 'runtime.sqlite'));
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(projectRoot, 'src-tauri/resources/longman.local');
await mkdir(path.dirname(destination), { recursive: true });
try {
  const info = await lstat(destination);
  if (!info.isSymbolicLink()) throw new Error(`Destination already exists: ${destination}`);
  const existing = await realpath(destination);
  if (existing !== textRoot) {
    if (existing !== packageRoot) throw new Error(`Preserve the existing link and choose LEXICUE_LONGMAN_PACKAGE_ROOT instead: ${destination}`);
    // Upgrade only our known old link; the original resource directory is untouched.
    await unlink(destination);
    await symlink(textRoot, destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await symlink(textRoot, destination, process.platform === 'win32' ? 'junction' : 'dir');
}
console.log(JSON.stringify({ release: manifest.data_release, source: textRoot, development_link: destination,
  start: 'npm run tauri dev', runtime: 'Native Rust; Python is not required',
  production: 'Install only text-v1 below <app_data>/dictionaries/longman; dictionary recordings are not used.' }, null, 2));
