"""Freeze the reviewed Longman edition into a private, standalone runtime package.

Source databases and MDX/MDD are opened read-only. No product provider is changed.
Run --help for the reproducible build command. Query needs Python's stdlib only;
strict validation additionally uses the bundled JSON Schema validator.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import tarfile
import zipfile

RELEASE = "longman6-reviewed-v5-quick-local-v1"
VERSION = "1.0.0"


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def json_write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def fingerprint(path):
    path = Path(path)
    return {"filename": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def deterministic_zip(directory, target):
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(Path(directory).rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            info = zipfile.ZipInfo(str(path.relative_to(directory)), (2026, 10, 26, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def deterministic_tar_xz(directory, target):
    with tarfile.open(target, "w:xz", preset=6) as archive:
        for path in sorted(Path(directory).rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            info = archive.gettarinfo(str(path), arcname=str(path.relative_to(directory)))
            info.mtime = 1792972800
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o644
            with path.open("rb") as stream:
                archive.addfile(info, stream)


def build(reviewed, metadata, output, mdx, mdd, vendor=None, note_bodies=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    target = output / "runtime.sqlite"
    if target.exists():
        raise FileExistsError(f"Refusing to replace {target}; use a fresh output directory")
    inputs = [fingerprint(p) for p in [reviewed, mdx, mdd, metadata] + ([note_bodies] if note_bodies else [])]
    src = sqlite3.connect(Path(reviewed).resolve().as_uri() + "?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    db = sqlite3.connect(target)
    db.execute("PRAGMA page_size=4096")
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("ATTACH DATABASE ? AS src", (Path(reviewed).resolve().as_uri() + "?mode=ro",))
    db.execute("ATTACH DATABASE ? AS pron", (Path(metadata).resolve().as_uri() + "?mode=ro",))
    # Review state is used during the build, never copied as an audit log.
    # English-only and dated reference material remains available with notices.
    db.execute("""CREATE TABLE senses AS SELECT s.*, CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END bilingual_candidate,
        r.flags_json FROM src.reviewed_senses s LEFT JOIN src.candidate_bilingual_senses c ON c.id=s.id
        LEFT JOIN src.meaning_reviews r ON r.sense_id=s.id
        WHERE trim(s.definition_en)<>'' AND NOT EXISTS
        (SELECT 1 FROM src.semantic_decisions d WHERE d.sense_id=s.id AND d.status NOT IN ('passed'))""")
    db.execute("CREATE UNIQUE INDEX senses_id ON senses(id)")
    db.execute("CREATE INDEX senses_unit ON senses(unit_id)")
    selections = {
        "units": "SELECT * FROM src.units WHERE id IN (SELECT unit_id FROM senses)",
        "examples": "SELECT e.* FROM src.reviewed_examples e JOIN senses s ON s.id=e.sense_id JOIN src.example_reviews r ON r.example_id=e.id WHERE r.flags_json IN ('[]','[\"chinese_missing\"]')",
        "sense_notes": "SELECT sn.* FROM src.reviewed_sense_notes sn JOIN senses s ON s.id=sn.sense_id",
        "notes": "SELECT n.* FROM src.reviewed_notes n WHERE n.id IN (SELECT note_id FROM sense_notes)",
        "note_examples": "SELECT e.* FROM src.reviewed_note_examples e JOIN notes n ON n.id=e.note_id WHERE e.display_adopted=1",
        "constructions": "SELECT * FROM src.reviewed_constructions",
        "sense_constructions": "SELECT sc.* FROM src.sense_constructions sc JOIN senses s ON s.id=sc.sense_id JOIN constructions c ON c.id=sc.construction_id",
        "sense_construction_examples": "SELECT e.* FROM src.reviewed_sense_construction_examples e JOIN senses s ON s.id=e.sense_id WHERE e.display_adopted=1",
        "construction_examples": "SELECT * FROM src.reviewed_construction_examples WHERE display_adopted=1",
        "occurrences": "SELECT o.* FROM src.occurrences o JOIN senses s ON s.id=o.sense_id",
        "construction_occurrences": "SELECT * FROM src.construction_occurrences",
        "lookup": "SELECT l.* FROM src.reviewed_lookup l JOIN units u ON u.id=l.unit_id",
        "query_senses": "SELECT q.* FROM src.reviewed_query_senses q JOIN senses s ON s.id=q.sense_id",
        "aliases": "SELECT * FROM src.resolved_source_aliases",
        "record_units": "SELECT r.* FROM src.record_units r JOIN units u ON u.id=r.unit_id",
        "source_records": "SELECT record_index,record_key,record_type,redirect_target FROM src.source_records",
        "inline_hints": "SELECT h.sense_id,h.text_en,h.text_zh FROM src.reviewed_inline_hints h JOIN senses s ON s.id=h.sense_id",
    }
    for name, sql in selections.items():
        db.execute(f"CREATE TABLE {name} AS {sql}")
    if note_bodies:
        db.execute("ATTACH DATABASE ? AS nb", (Path(note_bodies).resolve().as_uri() + "?mode=ro",))
        db.execute("""UPDATE notes SET english_json=(SELECT english_json FROM nb.note_bodies b WHERE b.id=notes.id),
            chinese_json=(SELECT chinese_json FROM nb.note_bodies b WHERE b.id=notes.id)
            WHERE id IN (SELECT id FROM nb.note_bodies) AND english_json='[]' AND chinese_json='[]'""")
    for name in ["groups", "group_map", "pronunciations", "forms"]:
        db.execute(f"CREATE TABLE {name} AS SELECT * FROM pron.{name}")
    if db.execute("SELECT 1 FROM pron.sqlite_master WHERE name='source_inline_hints'").fetchone():
        db.execute("""INSERT INTO inline_hints(sense_id,text_en,text_zh)
            SELECT DISTINCT h.sense_id,h.text_en,h.text_zh FROM pron.source_inline_hints h
            JOIN senses s ON s.id=h.sense_id WHERE NOT EXISTS
            (SELECT 1 FROM inline_hints i WHERE i.sense_id=h.sense_id)""")
    db.execute("DELETE FROM group_map WHERE sense_id NOT IN (SELECT id FROM senses)")
    db.execute("DELETE FROM groups WHERE id NOT IN (SELECT group_id FROM group_map)")
    for name in ["pronunciations", "forms"]:
        db.execute(f"DELETE FROM {name} WHERE group_id NOT IN (SELECT id FROM groups)")
    # Runtime locators contain dictionary identities/XPaths, never development paths.
    for rowid, raw in db.execute("SELECT rowid,source_json FROM occurrences").fetchall():
        value = json.loads(raw)
        if "reference" in value:
            value["reference"] = {k: v for k, v in value["reference"].items() if k not in {"path", "local_source"}}
        db.execute("UPDATE occurrences SET source_json=? WHERE rowid=?", (json.dumps(value, ensure_ascii=False, separators=(",", ":")), rowid))
    for name in ["units", "examples", "notes", "note_examples", "constructions", "construction_examples", "groups"]:
        db.execute(f"CREATE UNIQUE INDEX {name}_id ON {name}(id)")
    indexes = {"examples": ["sense_id"], "sense_notes": ["sense_id", "note_id"], "note_examples": ["note_id"],
               "sense_constructions": ["sense_id", "construction_id"], "sense_construction_examples": ["sense_id", "construction_id"],
               "construction_examples": ["construction_id"], "occurrences": ["sense_id", "record_index"],
               "construction_occurrences": ["construction_id"], "lookup": ["query_text", "lookup_key", "unit_id"],
               "query_senses": ["query_text"], "aliases": ["source_key", "lookup_key"], "record_units": ["record_index"],
               "groups": ["unit_id"], "group_map": ["sense_id", "group_id"], "pronunciations": ["group_id"], "forms": ["group_id", "text"], "inline_hints": ["sense_id"]}
    for table, columns in indexes.items():
        for column in columns:
            db.execute(f"CREATE INDEX {table}_{column} ON {table}({column})")
    db.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    db.executemany("INSERT INTO metadata VALUES(?,?)", [("data_release", RELEASE), ("builder_version", VERSION), ("schema_version", "1")])
    db.commit()
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    counts = {name: db.execute(f"SELECT count(*) FROM {name}").fetchone()[0] for name in tables}
    # Logical hash ignores SQLite page layout, compression metadata and filesystem times.
    logical = hashlib.sha256()
    for table in tables:
        logical.update(table.encode())
        for row in db.execute(f"SELECT * FROM {table} ORDER BY " + ",".join(str(i + 1) for i in range(len(db.execute(f'SELECT * FROM {table} LIMIT 0').description)))):
            logical.update(json.dumps(tuple(row), ensure_ascii=False, separators=(",", ":")).encode())
            logical.update(b"\n")
    integrity = db.execute("PRAGMA integrity_check").fetchall()
    assert integrity == [("ok",)], integrity
    db.execute("VACUUM")
    db.execute("CREATE INDEX constructions_lookup_key ON constructions(lookup_key)")
    db.commit()
    db.close()
    src.close()
    source_dir = Path(__file__).resolve().parent
    for name in ["package_query.py", "package_semantics.py"]:
        shutil.copyfile(source_dir / name, output / name)
    shutil.copyfile(source_dir.parents[1] / "docs/implementation/dictionary-result-v1.schema.json", output / "dictionary-result-v1.schema.json")
    if vendor:
        shutil.copytree(vendor, output / "vendor", ignore=shutil.ignore_patterns("__pycache__", "bin", "*.pyc"))
    (output / "README.txt").write_text(
        "朗文6私有离线运行时包 V1\n"
        "仅用于本地验证；没有切换 LexiCue 当前词典。\n"
        "查询：python3 package_query.py --package . 'look it up' --validate\n"
        "依赖：Python 3.10+；纯查询只用标准库，JSON Schema 校验器随 vendor 提供。\n"
        "完整文本及音标可离线使用；可选词头发音需传入匹配发音包路径。\n"
        "100组抽查98组中文、2组仅英文，不代表全书准确率。\n"
        "原有缺中文、旧百科信息保留并标记；待核实板球run-out义排除。\n"
        "例句音频及图片不包含；表达无独立发音时不借用母词读音。\n", encoding="utf-8")
    files = [dict(path=str(p.relative_to(output)), **fingerprint(p)) for p in sorted(output.rglob("*")) if p.is_file()]
    manifest = {"schema_version": 1, "data_release": RELEASE, "builder_version": VERSION,
                "runtime_database": "runtime.sqlite", "inputs": inputs, "counts": counts,
                "logical_sha256": logical.hexdigest(), "files": files,
                "audio_package": {"optional": True, "data_release": RELEASE, "manifest": "manifest.json"},
                "limitations": ["Original English-only content is preserved; no synthetic translations.",
                                 "One needs-verification cricket sense excluded.", "No sentence audio or images.",
                                 "Daily 100-query review does not certify whole-dictionary accuracy."]}
    json_write(output / "manifest.json", manifest)
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--reviewed", required=True, type=Path)
    p.add_argument("--metadata", required=True, type=Path)
    p.add_argument("--mdx", required=True, type=Path)
    p.add_argument("--mdd", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--vendor", type=Path)
    p.add_argument("--note-bodies", type=Path, help="source-owned note-body overlay from package_notes.py")
    p.add_argument("--zip", type=Path)
    p.add_argument("--tar-xz", type=Path)
    a = p.parse_args()
    manifest = build(a.reviewed, a.metadata, a.output, a.mdx, a.mdd, a.vendor, a.note_bodies)
    if a.zip:
        deterministic_zip(a.output, a.zip)
    if a.tar_xz:
        deterministic_tar_xz(a.output, a.tar_xz)
    print(json.dumps({"package": str(a.output.resolve()), "counts": manifest["counts"], "logical_sha256": manifest["logical_sha256"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
