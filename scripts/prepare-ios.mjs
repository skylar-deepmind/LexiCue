// The generated Xcode phase must work when Xcode opens outside the npm shell.
// Keep machine-specific tool locations with the ignored, generated project.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = join(root, 'src-tauri/gen/apple');
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js');

function run(cmd, args, cwd, env = process.env) {
  const child = spawnSync(cmd, args, {cwd, env, stdio: 'inherit'});
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}

if (process.argv[2] === '--xcode-build') {
  // Xcode's SDKROOT is for iOS. Cargo also builds host executables, including
  // dictionary dependencies with native code. Give those the host SDK.
  const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {encoding: 'utf8'}).trim();
  const env = {...process.env, CC_SHELL_ESCAPED_FLAGS: '1'};
  const quoted = "'" + sdk.replaceAll("'", "'\\''") + "'";
  for (const arch of ['aarch64', 'x86_64']) {
    for (const flags of ['CFLAGS', 'CXXFLAGS']) {
      const host = `${flags}_${arch}_apple_darwin`;
      env[host] = `${env[host] ?? ''} -isysroot ${quoted}`.trimStart();
    }
  }
  run(process.execPath, [cli, 'ios', 'xcode-script', ...process.argv.slice(3)], root, env);
} else {
  run(process.execPath, [cli, 'ios', 'init', ...process.argv.slice(2)], root);
  const yml = join(project, 'project.yml');
  const source = readFileSync(yml, 'utf8');
  const pattern = /^(\s*- script: ).*? ios xcode-script (.*)$/m;
  if (!pattern.test(source)) throw Error('Cannot locate the Rust build phase in the generated Xcode project.');
  const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.ios.conf.json'), 'utf8'));
  const minimum = config.bundle.iOS.minimumSystemVersion;
  // NODE_BINARY remains overridable. The default is the actual Node that ran
  // init, including nvm/asdf/pnpm installations absent from Xcode's PATH.
  writeFileSync(join(project, '.lexicue-node'), process.execPath + '\n');
  const script = '/usr/bin/env "${NODE_BINARY:-$(cat "$SRCROOT/.lexicue-node")}" "$SRCROOT/../../../scripts/prepare-ios.mjs" --xcode-build';
  const updated = source.replace(pattern, (_, indent, args) => `${indent}${script} ${args}`)
    .replace(/^(\s+iOS:) [\d.]+$/m, `$1 ${minimum}`);
  writeFileSync(yml, updated);
  run('xcodegen', ['generate'], project);
}
