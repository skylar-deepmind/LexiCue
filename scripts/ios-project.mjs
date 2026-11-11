// Tauri may preserve project.yml on a subsequent `ios init`.
export function prepareIosProject(source, {script, minimum, plist}) {
  const phase = /^(\s*- script: ).*?(?: ios xcode-script|prepare-ios\.mjs" --xcode-build) (.*)$/m;
  if (!phase.test(source)) throw Error('Cannot locate the Rust build phase in the generated Xcode project.');
  let updated = source.replace(phase, (_, indent, args) => `${indent}${script} ${args}`)
    .replace(/^(\s+iOS:) [\d.]+$/m, `$1 ${minimum}`)
    // Externals is a generated linker input, never an app resource. A second
    // XcodeGen run sees libapp.a from the previous build and otherwise copies
    // the entire archive into the application in addition to linking it.
    .replace(/^( +)- path: Externals(?:\n\1  buildPhase: \w+)?$/gm,
      (_, indent) => `${indent}- path: Externals\n${indent}  buildPhase: none`);
  // Replace our plist values rather than appending duplicates on every run.
  for (const key of Object.keys(plist)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    updated = updated.replace(new RegExp(`^        (?:"${escaped}"|${escaped}):[^\\n]*\\n?`, 'gm'), '');
  }
  const info = /^(    info:\n      path: [^\n]+\n      properties:)$/m;
  if (!info.test(updated)) throw Error('Cannot locate the generated application Info.plist properties.');
  const properties = Object.entries(plist)
    .map(([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n');
  return updated.replace(info, (_, section) => `${section}\n${properties}`);
}
