import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareIosProject} from './ios-project.mjs';

test('repeated iOS preparation preserves build arguments and updates plist once', () => {
  const source = `options:
  deploymentTarget:
    iOS: 13.0
targets:
  app:
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
});

test('an unknown generated project fails rather than losing its build phase', () => {
  assert.throws(() => prepareIosProject('unknown project', {}), /Rust build phase/);
});
