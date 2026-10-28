"""Acceptance checks against the actual corrected private dictionary edition."""

from pathlib import Path
import argparse
import json
import sqlite3

from finalize_review import SUPPLEMENTS_REVIEWED, TYPO_EDITS, lookup


def verify(path):
    db = sqlite3.connect(path / "longman6-reviewed.sqlite")
    db.row_factory = sqlite3.Row
    checks = []

    def check(name, condition):
        checks.append({"name": name, "passed": bool(condition)})

    def meanings(headword, candidate=False):
        table = "candidate_bilingual_senses" if candidate else "reviewed_senses"
        return db.execute(f"SELECT s.* FROM {table} s JOIN units u ON u.id=s.unit_id WHERE u.headword=?", (headword,)).fetchall()

    check("Every extracted meaning has an explicit review status", db.execute("SELECT COUNT(*) FROM senses").fetchone()[0] == db.execute("SELECT COUNT(*) FROM meaning_reviews").fetchone()[0])
    check("Every main example has an explicit review status", db.execute("SELECT COUNT(*) FROM examples").fetchone()[0] == db.execute("SELECT COUNT(*) FROM example_reviews").fetchone()[0])
    check("Candidates never include missing Chinese or held background entries", db.execute("SELECT COUNT(*) FROM candidate_bilingual_senses s JOIN meaning_reviews r ON r.sense_id=s.id WHERE s.definition_zh IS NULL OR r.flags_json!='[]'").fetchone()[0] == 0)
    check("kt/Kt have corrected Chinese and remain separate", len(meanings("kt", True)) == 1 and meanings("kt", True)[0]["definition_zh"] == "节" and len(meanings("Kt", True)) == 1 and meanings("Kt", True)[0]["definition_zh"] == "爵士" and lookup(db, "kt") != lookup(db, "Kt"))
    idiom = meanings("not know your arse from your elbow", True)
    check("Wrong hurry-up meaning never appears in the idiom", len(idiom) == 1 and "hurry" not in idiom[0]["definition_en"] and idiom[0]["definition_zh"] == "一无所知﹐屁都不懂")
    telephoto = meanings("telephoto lens", True)
    check("Split lens definition is complete", len(telephoto) == 1 and telephoto[0]["definition_en"].endswith("a long way away") and telephoto[0]["definition_zh"] == "长焦镜头﹐摄远镜头")
    restored = meanings("the finger of blame/suspicion", True)
    check("Missing expression restored from identified reference", len(restored) == 1 and restored[0]["definition_zh"] == "指责/怀疑的矛头")
    if restored:
        identifier = restored[0]["id"]
        origins = db.execute("SELECT source_json FROM occurrences WHERE sense_id=?", (identifier,)).fetchall()
        examples = db.execute("SELECT * FROM examples WHERE sense_id=?", (identifier,)).fetchall()
        check("Restored expression keeps both original locations and paired example", len(origins) == 2 and all(json.loads(r[0])["definition_origin"] == "restored_from_older_edition" for r in origins) and len(examples) == 1 and examples[0]["english"] == "The finger of suspicion immediately fell on Broderick." and examples[0]["chinese"] == "嫌疑立刻指向了布罗德里克。")
    check("Four missing translations filled only by reviewed identical reference definitions", db.execute("SELECT COUNT(*) FROM translation_supplements").fetchone()[0] == 4 and all(any(s["definition_zh"] == expected for s in meanings(h)) for h, expected in SUPPLEMENTS_REVIEWED.items()))
    check("Historical dates corrected while background stays out of candidates", "from 1993 to 2001" in meanings("Clinton, Bill")[0]["definition_en"] and not meanings("Clinton, Bill", True))
    for headword, (before, after) in TYPO_EDITS.items():
        check(f"Accidental duplicate fixed: {headword}", any(after in r["definition_en"] and before not in r["definition_en"] for r in meanings(headword)))
    check("Original text remains available underneath correction overlays", "from 1992 to 2000" in db.execute("SELECT definition_en FROM senses WHERE id=?", (meanings("Clinton, Bill")[0]["id"],)).fetchone()[0])
    check("Source redirect targets are resolved", db.execute("SELECT COUNT(*) FROM aliases WHERE target_record IS NULL").fetchone()[0] == 0)
    check("Resolved source aliases terminate at content rather than another redirect", db.execute("SELECT COUNT(*) FROM resolved_source_aliases a JOIN source_records r ON r.record_index=a.target_record WHERE r.record_type='redirect'").fetchone()[0] == 0 and db.execute("SELECT COUNT(DISTINCT source_key) FROM resolved_source_aliases").fetchone()[0] == db.execute("SELECT COUNT(DISTINCT source_key) FROM aliases").fetchone()[0])
    check("All five reviewed phrase forms are directly searchable", all(lookup(db, q) for q in ["get rid of", "piece of cake", "on cloud nine", "on thin ice", "in spite of"]))
    check("us/US case distinction is preserved", lookup(db, "us") and lookup(db, "US") and set(lookup(db, "us")).isdisjoint(lookup(db, "US")))
    check("Database integrity and foreign keys", db.execute("PRAGMA integrity_check").fetchone()[0] == "ok" and not db.execute("PRAGMA foreign_key_check").fetchall())
    result = {"checks": checks, "passed": sum(c["passed"] for c in checks), "total": len(checks),
              "limits": "Content-specific regression checks, not exhaustive semantic certification."}
    (path / "edition-acceptance.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    db.close()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["passed"] != result["total"]:
        raise SystemExit("Review edition acceptance failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    verify(parser.parse_args().path)
