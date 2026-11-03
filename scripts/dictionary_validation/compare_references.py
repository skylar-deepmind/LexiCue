"""Compare every pilot meaning with supplied reference files by exact wording.

Matching an English file is corroboration of transcription, not independent
semantic review: different files can share the same original mistakes.
Translations are proposed only for identical headword + complete definition.
"""

from collections import Counter
from pathlib import Path
import argparse
import hashlib
import json
import sqlite3
import time

from lxml import html

from longman6 import canonical, classes, encoded, normalize, parse_record, text_of
from mdict_source import MdictSource


def study_senses(markup):
    tree = html.fragment_fromstring(markup, create_parent="div")
    for definition in tree.iter("def"):
        owner = next((a for a in definition.iterancestors() if a.tag in {"entry", "phrvbentry"}), None)
        if owner is None:
            continue
        title = next(owner.iter("phrvbhwd" if owner.tag == "phrvbentry" else "hwd"), None)
        if title is None:
            continue
        headword = text_of(title, omit_tags={"inflx", "object"})
        kind = "phrasal_verb" if owner.tag == "phrvbentry" else "word"
        for ancestor in definition.iterancestors():
            if ancestor is owner:
                break
            lexical = next((n for n in ancestor if n.tag == "lexunit"), None)
            if lexical is not None:
                headword, kind = text_of(lexical, omit_tags={"inflx"}), "expression"
                break
        cn = [text_of(n) for n in definition.iter() if "ch_def" in classes(n) and text_of(n)]
        if len(cn) != 1:
            continue
        english = text_of(definition, omit_tags={"inflx"}, omit_classes={"ch_def"})
        if headword and english:
            yield headword, kind, english, cn[0], []


def compare(pilot, output, english_path, study_path):
    output.mkdir(parents=True, exist_ok=True)
    catalog = output / "reference-catalog.sqlite"
    if catalog.exists():
        raise FileExistsError(catalog)
    db = sqlite3.connect(catalog)
    db.executescript("""CREATE TABLE reference_meanings(source TEXT,record_index INTEGER,record_key TEXT,headword TEXT,kind TEXT,definition_en TEXT,definition_zh TEXT,full_forms TEXT,match_head TEXT,match_definition TEXT);
        CREATE INDEX reference_lookup ON reference_meanings(match_head,kind,match_definition);
        CREATE TABLE metadata(source TEXT,path TEXT,sha256 TEXT,records INTEGER,validated_blocks INTEGER);""")
    started = time.monotonic()
    for label, path in [("longman6_english_file", english_path), ("longman5_study_file", study_path)]:
        source = MdictSource(path)
        count = 0
        for index, (_, key) in enumerate(source.keys):
            markup = source.text(index)
            if markup.startswith("@@@LINK="):
                continue
            if label == "longman6_english_file":
                result = parse_record(markup, key, index)
                meanings = [(s["unit"]["headword"], s["unit"]["kind"], s["definition_en"], None, s["full_forms"]) for s in result["senses"]]
            else:
                meanings = study_senses(markup)
            for headword, kind, en, zh, forms in meanings:
                db.execute("INSERT INTO reference_meanings VALUES(?,?,?,?,?,?,?,?,?,?)", (
                    label, index, key, headword, kind, en, zh, encoded(forms), canonical(headword), normalize(en)))
                count += 1
            if index % 5000 == 0:
                db.commit()
                print(f"Reference {label}: {index}/{len(source.keys)}; meanings={count}; {time.monotonic()-started:.1f}s", flush=True)
        for block in range(len(source.blocks)):
            source.block(block)
        db.execute("INSERT INTO metadata VALUES(?,?,?,?,?)", (label, str(path), hashlib.sha256(path.read_bytes()).hexdigest(), len(source.keys), len(source.validated_blocks)))
        source.close(); db.commit()
    original = sqlite3.connect(pilot / "longman6-clean-pilot.sqlite")
    original.row_factory = sqlite3.Row
    counters = Counter()
    ledger = (output / "meaning-reference-checks.jsonl").open("w")
    proposals = []
    for sense in original.execute("SELECT s.*,u.headword,u.kind FROM senses s JOIN units u ON u.id=s.unit_id"):
        matches = db.execute("SELECT source,record_index,record_key,definition_zh,full_forms FROM reference_meanings WHERE match_head=? AND kind=? AND match_definition=?", (canonical(sense["headword"]), sense["kind"], normalize(sense["definition_en"]))).fetchall()
        english = [r for r in matches if r[0] == "longman6_english_file" and r[4] == sense["full_forms_json"]]
        study = [r for r in matches if r[0] == "longman5_study_file"]
        translations = sorted({r[3] for r in study if r[3]})
        item = {"sense_id": sense["id"], "headword": sense["headword"], "english_text_corroborated": bool(english),
                "study_definition_match": bool(study), "study_translation_variants": translations,
                "linguistic_review": "not_individually_reviewed"}
        counters["meanings_checked"] += 1
        counters["english_file_exact_definition_matches"] += bool(english)
        counters["study_file_exact_definition_matches"] += bool(study)
        if not sense["definition_zh"] and len(translations) == 1 and len(sense["definition_en"].split()) >= 4 and sense["full_forms_json"] == "[]":
            proposals.append({**item, "definition_en": sense["definition_en"], "proposed_chinese": translations[0],
                              "evidence": [{"source": r[0], "record_index": r[1], "record_key": r[2]} for r in study]})
        ledger.write(encoded(item) + "\n")
    ledger.close()
    (output / "translation-proposals.json").write_text(json.dumps(proposals, ensure_ascii=False, indent=2))
    metadata = [dict(zip(["source", "path", "sha256", "records", "validated_blocks"], r)) for r in db.execute("SELECT * FROM metadata")]
    summary = {**counters, "translation_proposals": len(proposals), "sources": metadata,
               "limits": "Exact source agreement does not prove meaning correctness; the English file shares some known defects. Proposed translations are not automatically adopted."}
    (output / "reference-comparison.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    original.close(); db.close()
    print(encoded(summary), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--english", type=Path, required=True)
    parser.add_argument("--study", type=Path, required=True)
    args = parser.parse_args()
    compare(args.pilot, args.output, args.english, args.study)
