"""Strict V1 schema validation plus relationships/content checks against runtime.

This validates transformation fidelity, not the dictionary's linguistic accuracy.
Use the frozen baseline review for that separate quick acceptance boundary.
"""
from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

from package_query import LocalDictionary, array, canonical, clean, safe_path


def _schema_path(package_root=None):
    if package_root:
        for name in ("dictionary-result-v1.schema.json", "schema.json"):
            path = Path(package_root) / name
            if path.is_file():
                return path
    return Path(__file__).resolve().parents[2] / "docs/implementation/dictionary-result-v1.schema.json"


@lru_cache(maxsize=4)
def _validator(path, mtime_ns, size):
    try:
        from jsonschema import Draft202012Validator, FormatChecker
    except ImportError as exc:
        raise RuntimeError("Strict validation requires jsonschema (or the delivered package/vendor)") from exc
    schema = json.loads(Path(path).read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate_schema(result, schema_path=None, package_root=None):
    """Return precise Draft202012 failures; never substitute a hand-written schema."""
    if package_root:
        vendor = Path(package_root) / "vendor"
        if vendor.is_dir() and str(vendor) not in sys.path:
            sys.path.insert(0, str(vendor))
    path = Path(schema_path or _schema_path(package_root)).resolve()
    stat = path.stat()
    validator = _validator(str(path), stat.st_mtime_ns, stat.st_size)
    return [{"kind": "schema", "path": "/" + "/".join(str(x) for x in err.absolute_path), "message": err.message}
            for err in sorted(validator.iter_errors(result), key=lambda x: str(list(x.absolute_path)))]


def _raw(identifier):
    return identifier.rsplit(":", 1)[-1]


def _all_notes(entry):
    yield from entry["notes"]
    for group in entry["groups"]:
        yield from group["notes"]
        for sense in group["senses"]:
            yield from sense["notes"]
            for pattern in sense["patterns"]:
                yield from pattern["notes"]


def validate_result(result, package_root=None, audio_root=None, schema_path=None, connection=None, dictionary=None):
    """Validate shape, namespaces, targets, scoped relationships and local assets.

    With package_root, binds all glosses and examples back to packaged source
    entities and verifies group membership. With no root, validates the V1 shape
    and referential/status semantics only.
    """
    errors = validate_schema(result, schema_path, package_root)
    if errors:
        return errors
    def fail(message, path="/"):
        errors.append({"kind": "semantic", "path": path, "message": message})
    entries = result["entries"]
    by_id = {e["id"]: e for e in entries}
    if len(by_id) != len(entries):
        fail("duplicate entry IDs")
    if entries and result["default_entry_id"] not in by_id:
        fail("default_entry_id does not name a returned entry")
    for n in result["notices"]:
        if n["entry_id"] is not None and n["entry_id"] not in by_id:
            fail("notice entry_id does not name a returned entry")
    default = by_id.get(result["default_entry_id"])
    if default:
        has_zh = any(s["meaning"]["zh"] for g in default["groups"] for s in g["senses"])
        if result["status"] == "found" and not has_zh:
            fail("found requires Chinese meaning in the default entry")
        if result["status"] == "partial" and has_zh and not any(n["code"] == "necessary_content_missing" for n in result["notices"]):
            fail("partial with Chinese requires a necessary-content gap notice")
    owns_dictionary = False
    db = connection or (dictionary.connection if dictionary else None)
    if package_root and entries and dictionary is None and connection is None:
        dictionary = LocalDictionary(package_root, audio_root, verify=False)
        owns_dictionary = True
        if dictionary.error:
            fail("cannot bind result to runtime: " + dictionary.error)
        else:
            db = dictionary.connection
    rows = lambda sql, params=(): [dict(x) for x in db.execute(sql, params)]
    query_text = canonical(result["query"]["text"])
    all_entity_ids = {}
    for entry in entries:
        prefix = f"{entry['source']['provider']}:{entry['source']['release']}:"
        scope_ids = {entry["id"]}
        returned_senses = {s["id"] for g in entry["groups"] for s in g["senses"]}
        restriction = set(entry["match"]["sense_ids"])
        if restriction and restriction != returned_senses:
            fail("match.sense_ids must equal the exact returned sense scope", entry["id"])
        if entry["match"]["type"] == "expression_pattern" and not restriction:
            fail("expression pattern must restrict applicable senses", entry["id"])
        if entry["source"]["provider"] == "longman" and (not entry["source"]["locator"] or not entry["source"]["entry_key"]):
            fail("Longman result requires original source locator and key", entry["id"])
        entry_raw = _raw(entry["id"])
        construction_entry = ":construction_entry:" in entry["id"]
        source_unit = None
        source_construction = None
        if db:
            if construction_entry:
                found = rows("SELECT * FROM constructions WHERE id=?", (entry_raw,))
                source_construction = found[0] if found else None
                if not source_construction or source_construction["pattern"] != entry["headword"]:
                    fail("construction entry headword is not source-bound", entry["id"])
                if canonical(entry["headword"]) != query_text:
                    fail("construction does not confirm the entire query expression", entry["id"])
                if source_construction and source_construction["parent_headword"] != entry["parent_headword"]:
                    fail("construction parent differs from source", entry["id"])
            else:
                found = rows("SELECT * FROM units WHERE id=?", (entry_raw,))
                source_unit = found[0] if found else None
                explicit_variant = bool(source_unit and rows("SELECT 1 FROM lookup WHERE query_text=? AND unit_id=? AND reason='source_explicit_header_variant'", (entry["headword"], entry_raw)))
                if not source_unit or source_unit["headword"] != entry["headword"] and not explicit_variant:
                    fail("entry headword is not source-bound", entry["id"])
                if dictionary:
                    allowed = dictionary._lookup(query_text)
                    if entry_raw not in {x[0] for x in allowed}:
                        fail("entry is not an authorized lookup target", entry["id"])
                    for unit_id, match_type, ss, group_filter in allowed:
                        if unit_id == entry_raw and ss and not {_raw(x) for x in returned_senses}.issubset(set(ss)):
                            fail("query leaked senses outside source-backed restriction", entry["id"])
        entity_records = [(entry["id"], entry)]
        for group in entry["groups"]:
            entity_records.append((group["id"], group))
            scope_ids.add(group["id"])
            group_raw = _raw(group["id"])
            if db and not construction_entry:
                gr = rows("SELECT * FROM groups WHERE id=? AND unit_id=?", (group_raw, entry_raw))
                if not gr:
                    fail("group does not belong to source unit", group["id"])
            for p in group["pronunciations"]:
                if p["audio"]:
                    if p["audio"]["kind"] != "local_file" or audio_root is None:
                        fail("local Longman audio requires explicit installed audio root", group["id"])
                    else:
                        try:
                            if not safe_path(audio_root, p["audio"]["location"]).is_file():
                                fail("audio asset is absent", group["id"])
                            if db and not rows("SELECT 1 FROM pronunciations WHERE group_id=? AND region=? AND audio_path=?", (group_raw, p["region"], p["audio"]["location"])):
                                fail("audio belongs to a different source group", group["id"])
                        except ValueError as exc:
                            fail(str(exc), group["id"])
                if db and not construction_entry and p["ipa"] and not rows("SELECT 1 FROM pronunciations WHERE group_id=? AND region=? AND ipa=?", (group_raw, p["region"], p["ipa"])):
                    fail("IPA belongs to a different source group", group["id"])
            for sense in group["senses"]:
                entity_records.append((sense["id"], sense))
                scope_ids.add(sense["id"])
                raw_sid = _raw(sense["id"])
                if db and not construction_entry:
                    original = rows("SELECT * FROM senses WHERE id=? AND unit_id=?", (raw_sid, entry_raw))
                    if not original:
                        fail("sense does not belong to source entry", sense["id"])
                    else:
                        original = original[0]
                        expected = {"en": clean(original["definition_en"]), "zh": clean(original.get("definition_zh")) if original.get("bilingual_candidate", 1) else None}
                        if sense["meaning"] != expected:
                            fail("sense English/Chinese pair differs from its adopted source", sense["id"])
                        if sense["labels"] != LocalDictionary._labels(original):
                            fail("sense labels differ from their adopted scope", sense["id"])
                        if not rows("SELECT 1 FROM group_map WHERE sense_id=? AND group_id=?", (raw_sid, group_raw)):
                            fail("sense appears in a different original group", sense["id"])
                        full_forms = array(original.get("full_forms_json"))
                        serialized = json.dumps(sense, ensure_ascii=False)
                        for value in full_forms:
                            if value not in serialized:
                                fail("necessary full-form complement was lost", sense["id"])
                        for note in sense["notes"]:
                            if ":note:" in note["id"]:
                                source_notes = rows("SELECT n.* FROM notes n JOIN sense_notes sn ON sn.note_id=n.id WHERE sn.sense_id=? AND n.id=?", (raw_sid, _raw(note["id"])))
                                if not source_notes:
                                    fail("usage note belongs to a different source sense", note["id"])
                                else:
                                    source_note = source_notes[0]
                                    heading = clean(source_note.get("heading"))
                                    expected_en = clean("\n".join(([heading] if heading else []) + array(source_note.get("english_json"))))
                                    expected_zh = clean("\n".join(array(source_note.get("chinese_json"))))
                                    if not array(source_note.get("english_json")) and not array(source_note.get("chinese_json")):
                                        expected_en = clean(source_note.get("original_text")) or expected_en
                                    if note["content"] != {"en": expected_en, "zh": expected_zh}:
                                        fail("usage note text/translation differs from its adopted source", note["id"])
                            elif ":hint:" in note["id"] and dictionary and "inline_hints" in dictionary.tables:
                                hints = rows("SELECT text_en,text_zh FROM inline_hints WHERE sense_id=?", (raw_sid,))
                                if not any(note["content"] == {"en": clean(x["text_en"]), "zh": clean(x["text_zh"])} for x in hints):
                                    fail("inline hint is not bound to the intended sense", note["id"])
                elif db and source_construction:
                    expected = {"en": clean("; ".join(array(source_construction.get("gloss_en_json")))), "zh": clean("；".join(array(source_construction.get("explanation_zh_json"))))}
                    if sense["meaning"] != expected:
                        fail("construction meaning differs from the source overall explanation", sense["id"])
                nested_pairs = set()
                for pattern in sense["patterns"]:
                    entity_records.append((pattern["id"], pattern))
                    pattern_raw = _raw(pattern["id"])
                    if db and not construction_entry and pattern_raw != raw_sid:
                        source_patterns = rows("SELECT c.* FROM sense_constructions sc JOIN constructions c ON c.id=sc.construction_id WHERE sc.sense_id=? AND sc.construction_id=?", (raw_sid, pattern_raw))
                        if not source_patterns:
                            fail("construction belongs to another sense", pattern["id"])
                        else:
                            source_pattern = source_patterns[0]
                            if source_pattern["pattern"] != pattern["text"]:
                                fail("construction text differs from source", pattern["id"])
                            pen = clean("; ".join(array(source_pattern.get("gloss_en_json"))))
                            pzh = clean("；".join(array(source_pattern.get("explanation_zh_json"))))
                            if pattern["explanation"] != ({"en": pen, "zh": pzh} if pen or pzh else None):
                                fail("construction explanation differs from its source", pattern["id"])
                    for ex in pattern["examples"]:
                        entity_records.append((ex["id"], ex))
                        nested_pairs.add((ex["english"], ex["chinese"]))
                        if db and not rows("SELECT 1 FROM sense_construction_examples WHERE sense_id=? AND construction_id=? AND id=? AND english=? AND COALESCE(chinese,'')=COALESCE(?,'')", (raw_sid, pattern_raw, _raw(ex["id"]), ex["english"], ex["chinese"])):
                            fail("construction example is paired with a different sense or text", ex["id"])
                for ex in sense["examples"]:
                    entity_records.append((ex["id"], ex))
                    if (ex["english"], ex["chinese"]) in nested_pairs:
                        fail("same-sense pattern example duplicated in main examples", ex["id"])
                    if db:
                        if not construction_entry:
                            adopted = rows("SELECT 1 FROM examples WHERE sense_id=? AND id=? AND english=? AND COALESCE(chinese,'')=COALESCE(?,'')", (raw_sid, _raw(ex["id"]), ex["english"], ex["chinese"]))
                        else:
                            adopted = rows("SELECT 1 FROM sense_construction_examples WHERE construction_id=? AND id=? AND english=? AND COALESCE(chinese,'')=COALESCE(?,'')", (entry_raw, _raw(ex["id"]), ex["english"], ex["chinese"]))
                            if not adopted and "construction_examples" in dictionary.tables:
                                adopted = rows("SELECT 1 FROM construction_examples WHERE construction_id=? AND id=? AND english=? AND COALESCE(chinese,'')=COALESCE(?,'')", (entry_raw, _raw(ex["id"]), ex["english"], ex["chinese"]))
                        if not adopted:
                            fail("example text/translation is not bound to its source meaning", ex["id"])
        for note in _all_notes(entry):
            entity_records.append((note["id"], note))
            for ex in note["examples"]:
                entity_records.append((ex["id"], ex))
                if db and not rows("SELECT 1 FROM note_examples WHERE note_id=? AND id=? AND english=? AND COALESCE(chinese,'')=COALESCE(?,'')", (_raw(note["id"]), _raw(ex["id"]), ex["english"], ex["chinese"])):
                    fail("note example is not bound to its source note", ex["id"])
        for identifier, entity in entity_records:
            if not identifier.startswith(prefix):
                fail("ID is missing provider/release namespace", identifier)
            serialized = json.dumps(entity, sort_keys=True, ensure_ascii=False)
            if identifier in all_entity_ids and all_entity_ids[identifier] != serialized:
                fail("same ID represents conflicting entities", identifier)
            all_entity_ids[identifier] = serialized
        for related in entry["related_expressions"]:
            if related["scope_id"] not in scope_ids:
                fail("related expression has invalid scope", entry["id"])
            if "#" in related["target_query"] or "://" in related["target_query"]:
                fail("related link target must be a dictionary query, not an MDX locator", entry["id"])
            if db and dictionary and not construction_entry:
                raw_scope = _raw(related["scope_id"])
                source_relations = rows("SELECT relations_json FROM senses WHERE id=? AND unit_id=?", (raw_scope, entry_raw))
                allowed_queries = set()
                for source_row in source_relations:
                    for relation in array(source_row["relations_json"]):
                        for target in relation.get("targets", []):
                            normalized = dictionary._related_query(target, entry["source"]["entry_key"])
                            if normalized:
                                allowed_queries.add(normalized)
                if related["target_query"] not in allowed_queries:
                    fail("related link query is not supported by its original source reference", entry["id"])
    if dictionary and owns_dictionary:
        dictionary.close()
    return errors
