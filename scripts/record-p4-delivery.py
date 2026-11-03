"""Record a local macOS P4 candidate after copying it from its DMG."""
import hashlib
import json
import plistlib
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent.parent
installed = Path(sys.argv[1]).resolve()
output = root / 'evidence/approved-slice-4/delivery-manifest.json'
app = root / 'src-tauri/target/release/bundle/macos/LexiCue P4 Candidate.app'
dmg = root / 'src-tauri/target/release/bundle/dmg/LexiCue P4 Candidate_0.4.5_aarch64.dmg'


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def run(*args):
    result = subprocess.run(args, cwd=root, text=True, capture_output=True, check=True)
    return (result.stdout + result.stderr).strip()


def inventory(directory):
    result = {}
    for path in sorted(directory.rglob('*')):
        item = {'mode': oct(stat.S_IMODE(path.lstat().st_mode))}
        if path.is_symlink():
            item.update(type='symlink', target=str(path.readlink()))
        elif path.is_file():
            item.update(type='file', bytes=path.stat().st_size, sha256=sha(path))
        else:
            item.update(type='directory')
        result[str(path.relative_to(directory))] = item
    return result


info = plistlib.loads((installed / 'Contents/Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == 'com.lexicue.slice-p4-candidate'
assert info['CFBundleShortVersionString'] == '0.4.5'
binary = Path('Contents/MacOS') / info['CFBundleExecutable']
original_files, installed_files = inventory(app), inventory(installed)
assert original_files == installed_files, 'DMG-installed bundle differs from packaged bundle'
configs = ['package.json', 'package-lock.json', 'src-tauri/Cargo.lock', 'src-tauri/Cargo.toml',
           'src-tauri/tauri.conf.json', 'src-tauri/tauri.slice-p4-candidate.conf.json']
receipt = json.loads((root / 'src-tauri/target/p4-build-receipt.json').read_text())
app_data = Path.home() / 'Library/Application Support/com.lexicue.slice-p4-candidate'
assert (app_data / 'lexicue.db').is_file(), 'Launch the installed candidate before recording delivery'
dictionary = app_data / 'dictionaries/longman'
if (dictionary / 'text-v1').is_dir():
    dictionary = dictionary / 'text-v1'
report = {
    'recordedAtUTC': datetime.now(timezone.utc).isoformat(),
    'scope': 'Local production-profile macOS arm64 candidate; ad-hoc signature, no publication or notarization',
    'codeCommit': receipt['codeCommit'], 'buildReceipt': receipt,
    'recordingCommit': run('git', 'rev-parse', 'HEAD'),
    'worktreeStatusAtRecording': run('git', 'status', '--short'),
    'system': run('sw_vers'), 'architecture': run('uname', '-m'),
    'versions': {key: info.get(key) for key in ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion']},
    'buildFlags': {'LEXICUE_SLICE_PREVIEW': '1', 'VITE_SLICE_PREVIEW': '1', 'VITE_SLICE_P4': '1',
                   'VITE_SLICE_QA': '0', 'VITE_SLICE_P2': '0', 'VITE_SLICE_P3': '0', 'LEXICUE_SYNC_ENDPOINT': '',
                   'CARGO_TARGET_DIR': str(root / 'src-tauri/target'), 'profile': 'release'},
    'configurationAndLocks': {name: sha(root / name) for name in configs},
    'sourceFonts': inventory(root / 'public/fonts'),
    'localDictionaryDependency': {name: sha(dictionary / name) for name in ['manifest.json', 'runtime.sqlite']},
    'app': str(app), 'installedApp': str(installed), 'installedFromDMG': True,
    'appBinarySHA256': sha(app / binary), 'installedBinarySHA256': sha(installed / binary),
    'dmg': str(dmg), 'dmgSHA256': sha(dmg),
    'installedBundleExactlyMatchesPackagedBundle': True,
    'codesignVerification': run('codesign', '--verify', '--deep', '--strict', str(installed)) or 'exit 0',
    'signatureDetails': run('codesign', '-dv', '--verbose=4', str(installed)),
    'gemmaPackagedHostCheck': run('node', 'scripts/check-gemma-macos-signing.mjs', '--app', str(installed)),
    'bundleFilesIncludingResourcesAndLicenses': installed_files,
    'appDataDirectory': str(app_data),
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: report[key] for key in ['codeCommit', 'appBinarySHA256', 'dmgSHA256',
                                            'installedBundleExactlyMatchesPackagedBundle']}, indent=2))
print(output)
