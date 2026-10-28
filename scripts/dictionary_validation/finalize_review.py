"""Build a private review edition with reversible corrections and per-item status.

The candidate view is a conservative bilingual selection, not a certificate
that every meaning has received individual linguistic or factual review.
Original tables remain intact; supplements are explicit, traceable overlays.
"""

from collections import Counter, defaultdict
from pathlib import Path
import argparse
import hashlib
import html as html_entities
import json
import re
import sqlite3

from lxml import html

from longman6 import canonical, encoded, normalize, parse_record, store_record, text_of
from mdict_source import MdictSource
from review_repairs import SOURCE_SHA256
from validate_pilot import CURATED


TYPO_EDITS = {
    "Bradford, Barbara Taylor": ("novels novels", "novels"),
    "Daily Mail, The": ("the The Times", "The Times"),
    "Kent, Clark": ("the The Daily Planet", "The Daily Planet"),
    "Lane, Lois": ("the The Daily Planet", "The Daily Planet"),
    "Madonna": ("most most successful", "most successful"),
    "Mingus, Charles": ("and and started", "and started"),
    "Mirror, The": ("the The Daily Mirror", "The Daily Mirror"),
    "Robinson, Gene": ("Bishop of of New Hampshire", "Bishop of New Hampshire"),
    "UN, the": ("1945 to to try", "1945 to try"),
    "xeriscape": ("has has been", "has been"),
}
VARIANTS_REVIEWED = {
    "be not all there", "that's it", "a/one hundred percent",
    "not/without so much as something", "in high dudgeon",
    "if it wasn't/weren't for somebody/something", "fall on stony ground", "(all) by yourself",
}
SUPPLEMENTS_REVIEWED = {
    "Liberal Democrats": "〔英国的〕自由民主党",
    "the Lords": "〔英国议会中的〕上议院﹐贵族院",
    "Methodist": "循道公会教徒",
    "twitter": "〔用社交网络工具推特〕发送推文",
}


def lexical_flags(english, chinese, full_forms=()):
    flags = []
    if not english.strip():
        flags.append("empty_english")
    if "\ufffd" in english + (chinese or "") or "\x00" in english + (chinese or ""):
        flags.append("damaged_text")
    if re.search(r"<\s*/?[a-z]+\b[^>]*>", english + (chinese or ""), re.I):
        flags.append("unremoved_html")
    if re.search(r"[\u3400-\u9fff]", english):
        flags.append("chinese_inside_english")
    if english.endswith((" abbreviation of", " short for", " plural of")) and not full_forms:
        flags.append("reference_complement_missing")
    if not chinese:
        flags.append("chinese_missing")
    if re.match(r"^\(\??\d{3,4}\s*[–−-]", english) or re.search(r"\bPopulation\s*:", english):
        flags.append("dated_encyclopedic_reference")
    return flags


def lookup(db, query):
    exact = db.execute("SELECT DISTINCT unit_id FROM reviewed_lookup WHERE query_text=?", (canonical(query),)).fetchall()
    rows = exact or db.execute("SELECT DISTINCT unit_id FROM reviewed_lookup WHERE lookup_key=?", (normalize(query),)).fetchall()
    return [r[0] for r in rows]


def without_article(value):
    """Dictionary article placement only; preserve meaningful letter case."""
    value = canonical(value)
    for article in ["the", "an", "a"]:
        if value.endswith(", " + article):
            return value[:-(len(article) + 2)]
        if value.startswith(article + " "):
            return value[len(article) + 1:]
    return value


def resolve_source_redirects(db):
    """Prefer real content when a source key has both content and redirects."""
    records = {r[0]: (r[1], r[2]) for r in db.execute("SELECT record_index,record_key,record_type FROM source_records")}
    targets = defaultdict(set)
    for key, index in db.execute("SELECT source_key,target_record FROM aliases WHERE target_record IS NOT NULL"):
        targets[key].add(index)
    errors = []
    mixed = set()

    def resolve(indices, trail=()):
        bodies = {i for i in indices if records[i][1] != "redirect"}
        if bodies:
            return bodies
        result = set()
        for i in indices:
            key = records[i][0]
            if i in trail:
                errors.append({"reason": "cycle_without_content", "keys": [records[j][0] for j in (*trail, i)]})
                continue
            if not targets[key]:
                errors.append({"reason": "missing_target", "query": key})
                continue
            result.update(resolve(targets[key], (*trail, i)))
        return result

    db.execute("CREATE TABLE resolved_source_aliases(source_key TEXT NOT NULL,lookup_key TEXT NOT NULL,target_record INTEGER REFERENCES source_records(record_index),PRIMARY KEY(source_key,target_record))")
    db.execute("CREATE INDEX resolved_source_alias_lookup ON resolved_source_aliases(lookup_key)")
    contexts = []
    for key, indices in targets.items():
        if any(records[i][1] == "redirect" for i in indices) and any(records[i][1] != "redirect" for i in indices):
            mixed.add(key)
        ends = resolve(indices)
        for index in sorted(ends):
            db.execute("INSERT INTO resolved_source_aliases VALUES(?,?,?)", (key, normalize(key), index))
        if ends and all(records[i][1] in {"reference_or_unhandled", "derivative_context"} for i in ends):
            contexts.append(key)
    return {"source_redirect_queries_checked": len(targets), "ambiguous_body_and_redirect_keys": sorted(mixed),
            "errors": errors, "context_only_queries": sorted(contexts)}


def restore_missing_phrase(db, pilot, older_path, changes):
    """Recover a missing source definition; preserve both original examples."""
    headword = "the finger of blame/suspicion"
    english = "if the finger of blame or suspicion points or is pointed at you, you're blamed for or suspected of being responsible for something"
    chinese = "指责/怀疑的矛头"
    source = MdictSource(older_path)
    matches = [i for i, (_, key) in enumerate(source.keys) if key == "finger"]
    if len(matches) != 1:
        raise ValueError("Older-definition record guard failed")
    record_index = matches[0]
    original_text = text_of(html.fragment_fromstring(source.text(record_index), create_parent="div"))
    if english not in original_text or chinese not in original_text:
        raise ValueError("Older-definition text guard failed")
    reference = {"path": str(older_path), "sha256": hashlib.sha256(older_path.read_bytes()).hexdigest(),
                 "record_key": "finger", "record_index": record_index, "sense_number": "9",
                 "external_corroboration": "https://www.oxfordlearnersdictionaries.com/definition/english/finger_1"}
    source.close()
    restored = set()
    for line in (pilot / "review-queue.jsonl").read_text().splitlines():
        item = json.loads(line)
        if item.get("reason") != "examples_without_owned_definition" or item["record_key"] not in {"finger", headword}:
            continue
        if len(item["examples"]) != 1 or item["examples"][0]["english"] != "The finger of suspicion immediately fell on Broderick.":
            raise ValueError("Restored-example guard failed")
        markup = '<span class="sense"><span class="lexunit">' + html_entities.escape(headword) + '</span><span class="def">' + html_entities.escape(english) + '</span><span class="defcn">' + chinese + '</span></span>'
        result = parse_record(markup, item["record_key"], item["record_index"])
        sense = result["senses"][0]
        sense["examples"] = item["examples"]
        sense["source"] = {"record_key": item["record_key"], "record_index": item["record_index"],
                           "scope_xpath": item["source_scope_xpath"], "definition_xpath": None,
                           "translation_xpaths": [], "anchors": [], "definition_origin": "restored_from_older_edition",
                           "reference": reference}
        change = {"rule": "restore_missing_definition_from_older_edition", "source_scope_xpath": item["source_scope_xpath"],
                  "before": {"definition_en": None, "definition_zh": None},
                  "after": {"definition_en": english, "definition_zh": chinese}, "evidence": reference}
        result["reviewed_changes"] = [change]
        store_record(db, result)
        changes.append({"kind": "reference_definition_restoration", "headword": headword, "record_key": item["record_key"], **change})
        restored.add((item["record_index"], item["source_scope_xpath"]))
    if len(restored) != 2:
        raise ValueError("Expected both original source occurrences to be restored")
    return restored


def finalize(pilot, references, output, older_path):
    validation = json.loads((pilot / "validation.json").read_text())
    audit = json.loads((pilot / "full-acceptance-results.json").read_text())
    if validation["source_sha256"] != SOURCE_SHA256 or not validation["reviewed_repairs_enabled"]:
        raise ValueError("Requires the fingerprinted, repaired edition")
    if audit["mode"] != "all_source_records" or audit["independently_parsed_records"] != validation["totals"]["body_records"] or audit["failures"] or not all(g["passed"] for g in audit["source_verified_acceptance"]):
        raise ValueError("Full source verification must pass before finalization")
    output.mkdir(parents=True, exist_ok=True)
    destination = output / "longman6-reviewed.sqlite"
    if destination.exists():
        raise FileExistsError(destination)
    original = sqlite3.connect(pilot / "longman6-clean-pilot.sqlite")
    db = sqlite3.connect(destination)
    original.backup(db); original.close()
    db.row_factory = sqlite3.Row
    db.executescript("""PRAGMA foreign_keys=ON;
        CREATE TABLE translation_supplements(sense_id TEXT PRIMARY KEY REFERENCES senses(id),chinese TEXT NOT NULL,evidence_json TEXT NOT NULL);
        CREATE TABLE definition_corrections(sense_id TEXT PRIMARY KEY REFERENCES senses(id),english TEXT NOT NULL,evidence_json TEXT NOT NULL);
        CREATE TABLE meaning_reviews(sense_id TEXT PRIMARY KEY REFERENCES senses(id),flags_json TEXT NOT NULL,english_reference_match INTEGER NOT NULL,study_reference_match INTEGER NOT NULL,individual_review TEXT NOT NULL,bilingual_candidate INTEGER NOT NULL);
        CREATE TABLE example_reviews(example_id TEXT PRIMARY KEY REFERENCES examples(id),flags_json TEXT NOT NULL,translation_available INTEGER NOT NULL);
        CREATE TABLE reviewed_lookup(query_text TEXT NOT NULL,lookup_key TEXT NOT NULL,unit_id TEXT REFERENCES units(id),reason TEXT NOT NULL,PRIMARY KEY(query_text,unit_id));
        CREATE INDEX reviewed_lookup_folded ON reviewed_lookup(lookup_key);
        CREATE VIEW reviewed_senses AS SELECT s.id,s.unit_id,COALESCE(d.english,s.definition_en) definition_en,COALESCE(t.chinese,s.definition_zh) definition_zh,s.pattern,s.grammar_json,s.register_json,s.signpost_json,s.geography_json,s.full_forms_json,s.relations_json,s.eligible FROM senses s LEFT JOIN translation_supplements t ON t.sense_id=s.id LEFT JOIN definition_corrections d ON d.sense_id=s.id;
        CREATE VIEW candidate_bilingual_senses AS SELECT s.* FROM reviewed_senses s JOIN meaning_reviews r ON r.sense_id=s.id WHERE r.bilingual_candidate=1;
        CREATE VIEW candidate_examples AS SELECT e.* FROM examples e JOIN candidate_bilingual_senses s ON s.id=e.sense_id JOIN example_reviews r ON r.example_id=e.id WHERE r.flags_json IN ('[]','["chinese_missing"]');
    """)
    redirect_audit = resolve_source_redirects(db)
    if redirect_audit["errors"]:
        raise ValueError("Source redirects must resolve without content-free cycles")
    changes = []
    for row in db.execute("SELECT * FROM correction_log"):
        changes.append({"kind": "source_repair", "record_key": row["record_key"], **json.loads(row["change_json"])})
    changes.extend({"kind": "redirect_repair", **r} for r in validation["reviewed_redirect_repairs"])
    restored_contexts = restore_missing_phrase(db, pilot, older_path, changes)
    proposals = json.loads((references / "translation-proposals.json").read_text())
    for item in proposals:
        if SUPPLEMENTS_REVIEWED.get(item["headword"]) != item["proposed_chinese"]:
            raise ValueError("Unreviewed translation proposal")
        row = db.execute("SELECT s.definition_en,s.definition_zh,u.headword FROM senses s JOIN units u ON u.id=s.unit_id WHERE s.id=?", (item["sense_id"],)).fetchone()
        if row is None or row["definition_zh"] is not None or row["definition_en"] != item["definition_en"] or row["headword"] != item["headword"]:
            raise ValueError("Translation supplement guard failed")
        evidence = {"rule": "reviewed_identical_definition_from_study_dictionary", "before": None,
                    "after": item["proposed_chinese"], "definition_en": item["definition_en"], "reference_records": item["evidence"]}
        db.execute("INSERT INTO translation_supplements VALUES(?,?,?)", (item["sense_id"], item["proposed_chinese"], encoded(evidence)))
        changes.append({"kind": "translation_supplement", "headword": item["headword"], **evidence})
    for headword, (before, after) in TYPO_EDITS.items():
        rows = db.execute("SELECT s.id,s.definition_en FROM senses s JOIN units u ON u.id=s.unit_id WHERE u.headword=?", (headword,)).fetchall()
        matches = [r for r in rows if r["definition_en"].count(before) == 1]
        if len(matches) != 1:
            raise ValueError(f"Typographical repair guard failed: {headword}")
        row = matches[0]
        evidence = {"rule": "reviewed_accidental_repeated_word", "before_fragment": before, "after_fragment": after,
                    "reason": "Remove one accidental duplicate; names, quotations, had had, and that that remain unchanged. This does not update dated biographical facts."}
        db.execute("INSERT INTO definition_corrections VALUES(?,?,?)", (row["id"], row["definition_en"].replace(before, after), encoded(evidence)))
        changes.append({"kind": "typographical_correction", "headword": headword, **evidence})
    clinton = db.execute("SELECT s.id,s.definition_en FROM senses s JOIN units u ON u.id=s.unit_id WHERE u.headword='Clinton, Bill'").fetchone()
    if clinton is None or "from 1992 to 2000" not in clinton["definition_en"]:
        raise ValueError("Presidential dates repair guard failed")
    evidence = {"rule": "verified_historical_dates", "before_fragment": "from 1992 to 2000", "after_fragment": "from 1993 to 2001",
                "source": "https://www.clintonlibrary.gov/museum/online-exhibits/constitution-and-clinton-presidency",
                "limits": "Only the dates were checked; the entire biographical entry remains a dated reference."}
    db.execute("INSERT INTO definition_corrections VALUES(?,?,?)", (clinton["id"], clinton["definition_en"].replace("from 1992 to 2000", "from 1993 to 2001"), encoded(evidence)))
    changes.append({"kind": "verified_factual_correction", "headword": "Clinton, Bill", **evidence})

    variant_ids = set()
    variant_groups = []
    conflicts = db.execute("""SELECT u.headword,s.unit_id,s.definition_en FROM senses s JOIN units u ON u.id=s.unit_id WHERE s.definition_zh IS NOT NULL GROUP BY s.unit_id,s.definition_en HAVING COUNT(DISTINCT s.definition_zh)>1""").fetchall()
    for row in conflicts:
        if row["headword"] not in VARIANTS_REVIEWED:
            raise ValueError("New translation variant group needs review")
        variants = db.execute("SELECT id,definition_zh FROM senses WHERE unit_id=? AND definition_en=?", (row["unit_id"], row["definition_en"])).fetchall()
        variant_ids.update(v["id"] for v in variants)
        variant_groups.append({"headword": row["headword"], "english": row["definition_en"], "translations": sorted({v["definition_zh"] for v in variants}),
                               "decision": "Compatible translations or punctuation variants; preserve original wordings, no conflict requiring a correction."})

    reviewed_scopes = set()
    boundary_scopes = set()
    for row in db.execute("SELECT * FROM correction_log"):
        change = json.loads(row["change_json"])
        if change["rule"] == "restore_reviewed_trailing_pattern_example":
            boundary_scopes.add((row["record_index"], change["after"]["repaired_scope_xpath"]))
        else:
            reviewed_scopes.add((row["record_index"], change["source_scope_xpath"]))
    specific_ids = set()
    for row in db.execute("SELECT sense_id,record_index,source_json FROM occurrences"):
        key = (row["record_index"], json.loads(row["source_json"])["scope_xpath"])
        if key in reviewed_scopes or key in boundary_scopes:
            specific_ids.add(row["sense_id"])

    reference = sqlite3.connect(references / "reference-catalog.sqlite")
    counters = Counter()
    ledger = (output / "meaning-review-status.jsonl").open("w")
    pending = (output / "pending-items.jsonl").open("w")
    for row in db.execute("SELECT s.*,u.headword,u.kind FROM reviewed_senses s JOIN units u ON u.id=s.unit_id"):
        flags = lexical_flags(row["definition_en"], row["definition_zh"], json.loads(row["full_forms_json"]))
        evidence = reference.execute("SELECT DISTINCT source,full_forms FROM reference_meanings WHERE match_head=? AND kind=? AND match_definition=?", (canonical(row["headword"]), row["kind"], normalize(row["definition_en"]))).fetchall()
        en_match = any(r[0] == "longman6_english_file" and r[1] == row["full_forms_json"] for r in evidence)
        study_match = any(r[0] == "longman5_study_file" for r in evidence)
        status = "not_individually_reviewed"
        if row["id"] in variant_ids or row["id"] in specific_ids or row["headword"] in SUPPLEMENTS_REVIEWED and db.execute("SELECT 1 FROM translation_supplements WHERE sense_id=?", (row["id"],)).fetchone():
            status = "selected_meaning_checked"
        candidate = bool(row["eligible"] and not flags)
        db.execute("INSERT INTO meaning_reviews VALUES(?,?,?,?,?,?)", (row["id"], encoded(flags), int(en_match), int(study_match), status, int(candidate)))
        item = {"sense_id": row["id"], "headword": row["headword"], "flags": flags, "english_reference_match": en_match,
                "study_reference_match": study_match, "individual_review": status, "bilingual_candidate": candidate}
        ledger.write(encoded(item) + "\n")
        counters["meanings_checked"] += 1
        counters["selected_meanings_individually_checked"] += status == "selected_meaning_checked"
        counters["bilingual_candidates"] += candidate
        counters["english_text_corroborated"] += en_match
        counters["study_definition_corroborated"] += study_match
        counters.update(flags)
        if flags:
            pending.write(encoded({**item, "english": row["definition_en"], "chinese": row["definition_zh"]}) + "\n")
    ledger.close(); pending.close()
    for row in db.execute("SELECT * FROM examples"):
        flags = lexical_flags(row["english"], row["chinese"])
        db.execute("INSERT INTO example_reviews VALUES(?,?,?)", (row["id"], encoded(flags), int(bool(row["chinese"]))))
        counters["examples_checked"] += 1
        counters["examples_missing_chinese"] += not bool(row["chinese"])
        counters["examples_with_text_problems"] += any(f != "chinese_missing" for f in flags)
    for row in db.execute("SELECT * FROM units"):
        db.execute("INSERT OR IGNORE INTO reviewed_lookup VALUES(?,?,?,?)", (canonical(row["headword"]), normalize(row["headword"]), row["id"], "exact_source_headword"))
    source_word_aliases = []
    for row in db.execute("""SELECT DISTINCT sr.record_key,u.id,u.headword FROM source_records sr JOIN record_units ru ON ru.record_index=sr.record_index JOIN units u ON u.id=ru.unit_id WHERE sr.record_type!='redirect' AND u.kind='word'"""):
        key, headword = canonical(row["record_key"]), canonical(row["headword"])
        if key != headword and without_article(key) == without_article(headword):
            db.execute("INSERT OR IGNORE INTO reviewed_lookup VALUES(?,?,?,?)", (key, normalize(key), row["id"], "source_record_article_form"))
            source_word_aliases.append({"query": key, "source_headword": headword, "unit_id": row["id"]})
    aliases = []
    for query, patterns in CURATED.items():
        if not patterns or query in patterns:
            continue
        for pattern in patterns:
            for row in db.execute("SELECT id FROM units WHERE headword=?", (pattern,)):
                db.execute("INSERT OR IGNORE INTO reviewed_lookup VALUES(?,?,?,?)", (query, normalize(query), row["id"], "reviewed_source_expression_pattern"))
                aliases.append({"query": query, "source_pattern": pattern, "unit_id": row["id"]})
    query_checks = []
    for query in CURATED:
        units = lookup(db, query)
        construction = db.execute("SELECT 1 FROM constructions WHERE lookup_key=? AND source_header_present=1", (normalize(query),)).fetchone()
        query_checks.append({"query": query, "found": bool(units or construction), "unit_matches": len(units), "collocation_context_only": not units and bool(construction)})
    if not all(q["found"] for q in query_checks):
        raise ValueError("Reviewed query lookup regressed")
    db.execute("INSERT INTO metadata VALUES(?,?)", ("review_layer", "reversible-v1; candidate selection is not exhaustive linguistic certification"))
    db.commit()
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    foreign_keys = db.execute("PRAGMA foreign_key_check").fetchall()
    source_log = [json.loads(line) for line in (pilot / "review-queue.jsonl").read_text().splitlines() if json.loads(line).get("reason") == "examples_without_owned_definition"]
    source_log = [r for r in source_log if (r["record_index"], r["source_scope_xpath"]) not in restored_contexts]
    summary = {**counters, "source_records": validation["source_records"], "body_records_independently_verified": audit["independently_parsed_records"],
               "source_check_failures": len(audit["failures"]), "evidenced_changes": len(changes), "change_types": dict(Counter(c["kind"] for c in changes)),
               "reviewed_translation_variant_groups": len(variant_groups), "reviewed_query_aliases": len({a["query"] for a in aliases}),
               "source_word_article_aliases": len(source_word_aliases),
               "source_redirect_queries_checked": redirect_audit["source_redirect_queries_checked"],
               "source_redirect_resolution_errors": len(redirect_audit["errors"]),
               "source_contexts_restored_from_reference": len(restored_contexts),
               "query_checks": query_checks, "remaining_source_example_exceptions": source_log,
               "sqlite_integrity": integrity, "foreign_key_errors": [list(r) for r in foreign_keys],
               "source_sha256": SOURCE_SHA256,
               "limits": "All records received correspondence checks and all extracted meanings received explicit quality status. Only selected meanings received individual semantic review. Candidate views exclude missing Chinese and dated encyclopedic entries; no guarantee of error-free dictionary content."}
    (output / "review-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (output / "corrections.jsonl").write_text("".join(encoded(c) + "\n" for c in changes))
    (output / "reviewed-translation-variants.json").write_text(json.dumps(variant_groups, ensure_ascii=False, indent=2))
    (output / "reviewed-query-aliases.json").write_text(json.dumps(aliases, ensure_ascii=False, indent=2))
    (output / "source-word-article-aliases.json").write_text(json.dumps(source_word_aliases, ensure_ascii=False, indent=2))
    (output / "redirect-audit.json").write_text(json.dumps(redirect_audit, ensure_ascii=False, indent=2))
    with (output / "semantic-review-queue.jsonl").open("w") as queue:
        for row in db.execute("""SELECT s.id,u.headword,u.kind,s.definition_en,s.definition_zh,r.english_reference_match,r.study_reference_match,r.bilingual_candidate FROM reviewed_senses s JOIN units u ON u.id=s.unit_id JOIN meaning_reviews r ON r.sense_id=s.id WHERE r.individual_review='not_individually_reviewed' ORDER BY r.bilingual_candidate DESC,r.english_reference_match ASC,CASE u.kind WHEN 'phrasal_verb' THEN 0 WHEN 'expression' THEN 1 ELSE 2 END,u.lookup_key"""):
            queue.write(encoded({**dict(row), "status": "尚未逐条核对含义，不能当作已审通过"}) + "\n")
    reference.close(); db.close()
    if integrity != "ok" or foreign_keys:
        raise ValueError("Final database integrity failed")
    print(encoded(summary))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--older", type=Path, required=True, help="Supplied Longman 4 bilingual file")
    args = parser.parse_args()
    finalize(args.pilot, args.references, args.output, args.older)
