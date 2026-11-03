"""Independent HTML-parser sampling and source-verified acceptance checks.

Uses BeautifulSoup's html.parser (not the extractor's lxml parser), a fixed
stratified random sample, and database round trips. It verifies preservation
and ownership; it is not an exhaustive linguistic proofreading of the source.
All output belongs beside the private pilot, outside the repository.
"""

from collections import Counter, defaultdict
from pathlib import Path
import argparse
import json
import random
import re
import sqlite3
import time

from bs4 import BeautifulSoup

from longman6 import encoded, normalize, parse_record
from mdict_source import MdictSource


CURATED = {
    "bank": ["bank"], "charge": ["charge"], "record": ["record"],
    "affect": ["affect"], "effect": ["effect"], "took": ["took"],
    "went": ["went"], "written": ["written"],
    "look up": ["look up"], "take off": ["take off"],
    "put up with": ["put up with"], "look forward to": ["look forward to"],
    "get rid of": ["get rid of somebody/something"], "make up": ["make up"],
    "turn down": ["turn down"], "give up": ["give up"],
    "carry out": ["carry out"], "put off": ["put off"], "work out": ["work out"],
    "break the ice": ["break the ice"], "kick the bucket": ["kick the bucket"],
    "out of the blue": ["out of the blue"], "piece of cake": ["be a piece of cake"],
    "make ends meet": ["make ends meet"], "spill the beans": ["spill the beans"],
    "hit the sack": ["hit the sack"], "once in a blue moon": ["once in a blue moon"],
    "cost an arm and a leg": [], "under the weather": ["under the weather"],
    "bite the bullet": ["bite the bullet"],
    "a blessing in disguise": ["a blessing in disguise"],
    "let the cat out of the bag": ["let the cat out of the bag"],
    "on cloud nine": ["be on cloud nine"],
    "on thin ice": ["be skating on thin ice", "be (walking/treading/skating) on thin ice", "be (skating) on thin ice"],
    "in spite of": ["in spite of something"], "on the other hand": ["on the other hand"],
}


def plain(tag):
    return re.sub(r"\s+", " ", tag.get_text("", strip=False)).strip()


def independent_projection(markup):
    """Read direct sense ownership with a separate parser and traversal."""
    soup = BeautifulSoup(markup, "html.parser")
    omitted = {"at-link", "buttons", "Tail", "entrymenu", "f2nbox", "thesbox",
               "collobox", "grambox", "grammarbox", "usagebox", "runon"}
    for tag in list(soup.find_all(True)):
        if not isinstance(tag.attrs, dict):
            continue
        if tag.name in {"script", "style", "audio", "source", "img"} or omitted.intersection(tag.get("class", [])):
            tag.decompose()
    scopes = defaultdict(lambda: {"definitions": [], "translations": [], "examples": []})
    for tag in soup.find_all(True):
        cls = set(tag.get("class", []))
        if not cls.intersection({"def", "defcn", "example"}):
            continue
        ancestor = tag.parent
        while ancestor is not None and not set(ancestor.get("class", [])).intersection({"sense", "subsense"}):
            ancestor = ancestor.parent
        group = scopes[id(ancestor)]
        if "def" in cls:
            group["definitions"].append(plain(tag))
        if "defcn" in cls:
            group["translations"].append(plain(tag))
        if "example" in cls:
            en = tag.find_all("expen")
            zh = tag.find_all("expcn")
            if en:
                english = " ".join(plain(n) for n in en)
            else:
                copy = BeautifulSoup(str(tag), "html.parser")
                for n in copy.find_all("expcn"):
                    n.decompose()
                english = re.sub(r"^[·•]\s*", "", plain(copy))
            group["examples"].append((english, " ".join(plain(n) for n in zh) or None))
    return list(scopes.values())


def pairs_projection(groups):
    return Counter((tuple(g["definitions"]), tuple(g["translations"])) for g in groups if g["definitions"])


def association_projection(groups):
    return Counter((tuple(g["definitions"]), tuple(g["translations"]), tuple(sorted(g["examples"], key=encoded))) for g in groups if g["definitions"])


def parsed_projection(result):
    groups = [{
        "definitions": [s["definition_en"]], "translations": s["source_translation_fragments"],
        "examples": [(e["english"], e["chinese"]) for e in s["examples"]],
    } for s in result["senses"]]
    for q in result["quarantined"]:
        if q.get("definition_count", 0):
            groups.append({
                "definitions": q["definitions"], "translations": q.get("translations", []),
                "examples": [(e["english"], e["chinese"]) for e in q.get("examples", [])],
            })
    return groups


def audit(source_path, pilot, sample_size=200, all_records=False):
    source = MdictSource(source_path)
    db = sqlite3.connect(pilot / "longman6-clean-pilot.sqlite")
    db.row_factory = sqlite3.Row
    format_row = db.execute("SELECT value FROM metadata WHERE key='format'").fetchone()
    reviewed = bool(format_row and format_row[0] == "longman6-reviewed-v5")
    population = db.execute("SELECT record_index,record_key FROM source_records WHERE record_type!='redirect'").fetchall()
    one = [r["record_index"] for r in population if " " not in r["record_key"]]
    multi = [r["record_index"] for r in population if " " in r["record_key"]]
    generator = random.Random(20261025)
    selected = set(generator.sample(one, sample_size // 2) + generator.sample(multi, sample_size - sample_size // 2))
    random_indices = sorted(selected)
    curated_keys = set(CURATED) | {n for names in CURATED.values() for n in names}
    curated_keys |= {"cost", "not know your arse from your elbow", "kt", "Kt", "approx.",
                     "telephoto lens", "Et tu, Brute?", "stop", "wipe"}
    selected.update(r["record_index"] for r in population if r["record_key"] in curated_keys)
    for key in curated_keys:
        selected.update(r[0] for r in db.execute("SELECT target_record FROM aliases WHERE source_key=? AND target_record IS NOT NULL", (key,)))
    selected = {i for i in selected if not source.text(i).startswith("@@@LINK=")}
    if all_records:
        selected = {r["record_index"] for r in population}
    prefix = "full-" if all_records else ""
    ledger = (pilot / (prefix + "record-checks.jsonl")).open("w")
    started = time.monotonic()
    results, failures, exceptions = [], [], []
    for number, index in enumerate(sorted(selected), 1):
        key = source.keys[index][1]
        markup = source.text(index)
        result = parse_record(markup, key, index, reviewed=reviewed)
        original = independent_projection(markup)
        cleaned = parsed_projection(result)
        # Edited content is expected to differ. Independently verify the raw
        # original, then verify the guarded corrected result survives storage.
        changes = result["reviewed_changes"]
        before_repairs = parsed_projection(parse_record(markup, key, index)) if changes else cleaned
        aligned = pairs_projection(original) == pairs_projection(before_repairs)
        exceptional = bool(result["quarantined"] or result["layout_repairs"] or changes)
        association = None if exceptional else association_projection(original) == association_projection(cleaned)
        saved = {(r["sense_id"], r["source_json"]) for r in db.execute("SELECT sense_id,source_json FROM occurrences WHERE record_index=?", (index,))}
        expected = {(s["id"], encoded(s["source"])) for s in result["senses"]}
        round_trip = saved == expected
        for sense in result["senses"]:
            for ex in sense["examples"]:
                row = db.execute("""SELECT 1 FROM examples e JOIN example_occurrences o ON o.example_id=e.id
                    WHERE e.sense_id=? AND e.english=? AND e.chinese IS ? AND o.record_index=? AND o.source_xpath=?""",
                    (sense["id"], ex["english"], ex["chinese"], index, ex["source_xpath"])).fetchone()
                round_trip = round_trip and row is not None
        item = {"record_index": index, "key": key, "random_sample": index in random_indices,
                "definition_translation_alignment": aligned, "example_ownership": association,
                "database_round_trip": round_trip,
                "evidenced_correction_count": len(changes),
                "sense_observations": len(result["senses"]),
                "main_example_observations": sum(len(s["examples"]) for s in result["senses"])}
        results.append(item)
        ledger.write(encoded(item) + "\n")
        if exceptional:
            exceptions.append({"key": key, "quarantine_reasons": [q["reason"] for q in result["quarantined"]], "repairs": result["layout_repairs"]})
        if not aligned or association is False or not round_trip:
            failures.append(item)
        if number % 1000 == 0:
            ledger.flush()
            print(f"Checked {number}/{len(selected)} source records; failures={len(failures)}; {time.monotonic()-started:.1f}s", flush=True)
    ledger.close()
    gold = []

    def check(name, condition):
        gold.append({"name": name, "passed": bool(condition)})

    source_keys = defaultdict(list)
    for i, (_, key) in enumerate(source.keys):
        source_keys[key].append(i)

    def records(key, visited=None):
        visited = set() if visited is None else visited
        if key in visited:
            raise ValueError(f"Source redirect cycle at {key}")
        visited.add(key)
        output = []
        for i in source_keys[key]:
            markup = source.text(i)
            if markup.startswith("@@@LINK="):
                output.extend(records(markup[8:].strip(), visited.copy()))
            else:
                output.append(parse_record(markup, key, i, reviewed=reviewed))
        return output

    def senses(key, headword=None):
        return [s for r in records(key) for s in r["senses"] if headword is None or s["unit"]["headword"] == headword]

    bank = senses("bank", "bank")
    check("bank: 8 noun + 6 verb senses, not popup meanings", len(bank) == 14 and Counter(s["unit"]["part_of_speech"] for s in bank) == {"noun": 8, "verb": 6})
    check("bank: river-bank Chinese stays with land-along-water definition", any("land along" in s["definition_en"] and "岸" in (s["definition_zh"] or "") for s in bank))
    for key, count, example_count in [("look up", 3, 4), ("take off", 5, 6), ("put up with", 1, 1), ("break the ice", 1, 1), ("took", 1, 0)]:
        data = senses(key)
        check(f"{key}: source sense/example totals {count}/{example_count}", len(data) == count and sum(len(s["examples"]) for s in data) == example_count)
    lu = senses("look up")
    check("look up: improve, consult, and visit keep their Chinese and object slots", len(lu) == 3 and "好转" in (lu[0]["definition_zh"] or "") and "something" in lu[1]["expression_pattern"] and "somebody" in lu[2]["expression_pattern"])
    puw = records("put up with")[0]
    check("put up with: tolerate example stays in usage note", sum(len(n["examples"]) for n in puw["notes"]) == 1 and all("tolerate" not in e["english"] for s in puw["senses"] for e in s["examples"]))
    bad_idiom = records("not know your arse from your elbow")
    if reviewed:
        check("bad idiom: correct meaning recovered; hurry-up meaning stays excluded", bool(bad_idiom) and all(len(r["senses"]) == 1 and r["senses"][0]["definition_zh"] == "一无所知﹐屁都不懂" and any(q["reason"] == "reviewed_wrong_definition_removed" for q in r["quarantined"]) for r in bad_idiom))
        check("kt/Kt: corrected Chinese matches the preserved full form", all(len(senses(k)) == 1 and senses(k)[0]["full_forms"] == [form] and senses(k)[0]["definition_zh"] == zh and senses(k)[0]["eligible"] for k, form, zh in [("kt", "knot", "节"), ("Kt", "knight", "爵士")]))
        check("telephoto lens: one complete definition recovered", len(senses("telephoto lens")) == 1 and "that you put on a camera" in senses("telephoto lens")[0]["definition_en"])
        check("stop/wipe: source pattern examples no longer orphaned", all(not any(q["reason"] == "examples_without_owned_definition" for q in r["quarantined"]) for key in ["stop", "wipe"] for r in records(key)))
        check("source redirects: no unresolved targets after guarded article repair", db.execute("SELECT COUNT(*) FROM aliases WHERE target_record IS NULL").fetchone()[0] == 0)
    else:
        check("bad idiom: mixed hurry-up definition quarantined", bool(bad_idiom) and all(not r["senses"] and any(q["reason"] == "multiple_definitions_in_scope" for q in r["quarantined"]) for r in bad_idiom))
        check("kt/Kt: case and full forms preserved; swapped Chinese blocked", all(len(senses(k)) == 1 and senses(k)[0]["full_forms"] == [form] and not senses(k)[0]["eligible"] for k, form in [("kt", "knot"), ("Kt", "knight")]))
    check("approx.: full form survives outside def span", senses("approx.")[0]["full_forms"] == ["approximately"])
    row = db.execute("SELECT * FROM constructions WHERE lookup_key=?", ("cost an arm and a leg",)).fetchone()
    check("cost an arm and a leg: collocation gloss and own example retained", row is not None and "price" in row["gloss_en_json"] and db.execute("SELECT COUNT(*) FROM construction_examples WHERE construction_id=?", (row["id"],)).fetchone()[0] == 1)
    query_results = []
    for query, patterns in CURATED.items():
        units = []
        for pattern in patterns:
            for u in db.execute("SELECT * FROM units WHERE headword=?", (pattern,)):
                rows = db.execute("SELECT * FROM senses WHERE unit_id=?", (u["id"],)).fetchall()
                examples = [dict(e) for s in rows for e in db.execute("SELECT english,chinese FROM examples WHERE sense_id=?", (s["id"],))]
                units.append({"headword": u["headword"], "kind": u["kind"], "pos": u["pos"],
                              "senses": [{"english": s["definition_en"], "chinese": s["definition_zh"], "pattern": s["pattern"]} for s in rows], "examples": examples})
        constructions = [dict(r) for r in db.execute("SELECT * FROM constructions WHERE lookup_key=?", (normalize(query),))]
        query_results.append({"query": query, "source_patterns": patterns,
                              "exact_unit_match": any(u["headword"] == query for u in units),
                              "requires_source_pattern_alias": bool(units) and not any(u["headword"] == query for u in units),
                              "units": units, "construction_matches": constructions,
                              "covered_in_source": bool(units or constructions)})
    summary = {"mode": "all_source_records" if all_records else "sample", "reviewed_corrections": reviewed, "random_seed": 20261025, "random_sample_size": len(random_indices),
               "random_single_token": sample_size // 2, "random_multiword": sample_size - sample_size // 2,
               "independently_parsed_records": len(results), "failures": failures,
               "exception_records": exceptions, "source_verified_acceptance": gold,
               "query_cases": len(query_results),
               "query_cases_with_source_content": sum(q["covered_in_source"] for q in query_results),
               "query_cases_requiring_pattern_alias": [q["query"] for q in query_results if q["requires_source_pattern_alias"]],
               "records": results,
               "limits": "Structural preservation and selected source checks; not full linguistic proofreading. Pattern candidates are explicit audit mappings, not a production fuzzy search."}
    (pilot / (prefix + "acceptance-results.json")).write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (pilot / (prefix + "review-samples.json")).write_text(json.dumps(query_results, ensure_ascii=False, indent=2))
    source.close(); db.close()
    print(json.dumps({k: v for k, v in summary.items() if k not in {"records", "exception_records"}}, ensure_ascii=False, indent=2))
    if failures or any(not g["passed"] for g in gold):
        raise SystemExit("Pilot acceptance failed; inspect the saved evidence")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--pilot", required=True, type=Path)
    parser.add_argument("--sample-size", type=int, default=200)
    parser.add_argument("--all-records", action="store_true")
    args = parser.parse_args()
    audit(args.source, args.pilot, args.sample_size, args.all_records)
