import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareIosProject} from './ios-project.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('repeated iOS preparation preserves build arguments and updates plist once', () => {
  const source = `options:
  deploymentTarget:
    iOS: 13.0
targets:
  app:
    sources:
      - path: Externals
    preBuildScripts:
      - script: node cli.js ios xcode-script --platform \${PLATFORM_DISPLAY_NAME} --release
    info:
      path: app/Info.plist
      properties:
        CFBundleShortVersionString: 0.4.6
        UIFileSharingEnabled: false
`;
  const options = {script: '/usr/bin/env node "$SRCROOT/../../../scripts/prepare-ios.mjs" --xcode-build', minimum: '15.0', plist: {UIFileSharingEnabled: true, UIBackgroundModes: ['audio']}};
  const first = prepareIosProject(source, options);
  assert.equal(prepareIosProject(first, options), first);
  assert.match(first, /--xcode-build --platform \$\{PLATFORM_DISPLAY_NAME\} --release/);
  assert.match(first, /iOS: 15\.0/);
  assert.match(first, /CFBundleShortVersionString: 0\.4\.6/);
  assert.equal(first.match(/UIFileSharingEnabled/g).length, 1);
  assert.match(first, /"UIFileSharingEnabled": true/);
  assert.match(first, /"UIBackgroundModes": \["audio"\]/);
  assert.equal(first.match(/buildPhase: none/g).length, 1);
});

test('an unknown generated project fails rather than losing its build phase', () => {
  assert.throws(() => prepareIosProject('unknown project', {}), /Rust build phase/);
});

test('XcodeGen keeps a previously built static archive out of app resources', {
  skip: process.platform !== 'darwin' ? 'requires the native XcodeGen tool' : false,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicue-ios-project-'));
  try {
    mkdirSync(join(dir, 'Externals/arm64/release'), {recursive: true});
    mkdirSync(join(dir, 'app'));
    writeFileSync(join(dir, 'PrivacyInfo.xcprivacy'), readFileSync(new URL('../src-tauri/PrivacyInfo.xcprivacy', import.meta.url)));
    writeFileSync(join(dir, 'Externals/arm64/release/libapp.a'), '!<arch>\n');
    const source = `name: ArchiveProbe
targets:
  app:
    type: application
    platform: iOS
    deploymentTarget: "15.0"
    sources:
      - path: Externals
    dependencies:
      - framework: libapp.a
        embed: false
    preBuildScripts:
      - script: node cli.js ios xcode-script --release
    info:
      path: app/Info.plist
      properties:
        CFBundleShortVersionString: 0.4.6
`;
    const options = {script: 'node "prepare-ios.mjs" --xcode-build', minimum: '15.0', plist: {UIFileSharingEnabled: true}, privacyManifest: 'PrivacyInfo.xcprivacy'};
    let prepared = prepareIosProject(source, options);
    for (let run = 0; run < 2; run++) {
      writeFileSync(join(dir, 'project.yml'), prepared);
      execFileSync('xcodegen', ['generate', '--spec', join(dir, 'project.yml'), '--project', dir], {stdio: 'pipe'});
      const pbx = readFileSync(join(dir, 'ArchiveProbe.xcodeproj/project.pbxproj'), 'utf8');
      assert.doesNotMatch(pbx, /libapp\.a in Resources/);
      assert.match(pbx, /libapp\.a in Frameworks/);
      assert.match(pbx, /PrivacyInfo\.xcprivacy in Resources/);
      assert.equal(prepared.match(/- path: PrivacyInfo\.xcprivacy/g).length, 1);
      const next = prepareIosProject(prepared, options);
      assert.equal(next, prepared);
      prepared = next;
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
