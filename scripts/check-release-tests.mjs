import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared by local packaging and the mandatory Actions preflight. Keep the
// regression suite on the same commit as the installers it protects.
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
env.LINDERA_DICTIONARIES_PATH ||= join(root, 'scripts/cache/lindera');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd = root) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(npm, ['run', 'lint']);
run(npm, ['test']);
run(npm, ['run', 'prepare:gemma']);
run(process.execPath, ['scripts/check-gemma-macos-signing.mjs']);
run(npm, ['run', 'build']);
run('cargo', ['test', '--lib', '--locked'], join(root, 'src-tauri'));
console.log('Release regression checks passed.');
