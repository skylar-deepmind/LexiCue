#!/usr/bin/env python3
"""Capture an explicitly named legacy DB without opening/writing its source.

Read DB and optional WAL/SHM together; accept only a stable before/copy/after SHA256
capture, then use SQLite backup on the private capture (never on the source).
Report schema/count metadata only. Captured user data stays in the explicit
local temporary output directory and must never be committed or uploaded.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile


def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            sha.update(chunk)
    return {'bytes': path.stat().st_size, 'sha256': sha.hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    output = args.output.resolve()
    if not source.is_file() or source == output:
        raise SystemExit('source must be one explicit existing SQLite database')
    temporary_roots = [Path(tempfile.gettempdir()).resolve(), Path('/tmp').resolve()]
    if not any(root in output.parents for root in temporary_roots):
        raise SystemExit('private output must be inside the OS temporary directory')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    captured = output / 'captured'
    captured.mkdir(mode=0o700)
    captured_db = captured / source.name
    paths = [source, source.with_name(source.name + '-wal'), source.with_name(source.name + '-shm')]
    stable = None
    for attempt in range(3):
        present = [path for path in paths if path.exists()]
        before = {path.name: digest(path) for path in present}
        for path in present:
            target = captured / path.name
            with path.open('rb') as original, target.open('wb') as copy:
                shutil.copyfileobj(original, copy)
            target.chmod(0o600)
        after = {path.name: digest(path) for path in paths if path.exists()}
        copied = {path.name: digest(captured / path.name) for path in present}
        if before == after == copied:
            stable = before
            break
        for path in captured.iterdir():
            path.unlink()
    if stable is None:
        raise SystemExit('source DB/WAL/SHM changed during all three captures; no accepted snapshot')
    # Opening the private capture replays its WAL. A normal SQLite backup then
    # produces a standalone, consistent destination without a source connection.
    conn = sqlite3.connect(captured_db)
    standalone = output / 'legacy-consistent.db'
    target = sqlite3.connect(standalone)
    try:
        conn.backup(target)
        integrity = target.execute('PRAGMA integrity_check').fetchall()
        foreign_keys = target.execute('PRAGMA foreign_key_check').fetchall()
        if integrity != [('ok',)] or foreign_keys:
            raise RuntimeError('captured snapshot failed integrity/foreign-key checks')
        tables = {name: [row[1] for row in target.execute(f'PRAGMA table_info("{name}")')]
                  for name, in target.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")}
        business = ('files', 'segments', 'words', 'occurrences', 'phrases', 'phrase_occurrences', 'reviews', 'review_logs', 'phrase_reviews', 'phrase_review_logs', 'saved_records', 'product_migrations')
        counts = {table: target.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                  for table in business if table in tables}
        language_counts = {table: dict(target.execute(f'SELECT language,COUNT(*) FROM {table} GROUP BY language'))
                           for table in ('files', 'words', 'phrases') if table in tables and 'language' in tables[table]}
    finally:
        target.close()
        conn.close()
    standalone.chmod(0o600)
    # Confirm reads/copying did not coincide with later source modifications.
    final = {path.name: digest(path) for path in paths if path.exists()}
    manifest = {'source_directory': source.parent.name, 'source_name': source.name,
                'source_opened_by_sqlite': False, 'stable_capture': stable,
                'source_still_matches_capture': final == stable,
                'standalone_snapshot': str(standalone), 'integrity_check': 'ok',
                'foreign_key_violations': 0, 'tables': tables, 'counts': counts,
                'language_counts': language_counts}
    (output / 'metadata.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({key: value for key, value in manifest.items() if key not in ('tables', 'stable_capture')}, indent=2))


if __name__ == '__main__':
    main()
