#!/usr/bin/env python3
"""Read a frozen Longman runtime package without its MDX/MDD or review database.

The query path uses only the standard library. Optional --validate uses the real
Draft 2020-12 jsonschema validator and additional source-binding checks.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote

ADAPTER_VERSION = "1.0.0"


def clean(value):
    return re.sub(r"\s+", " ", str(value)).strip() or None if value is not None else None


def canonical(value):
    return clean(unicodedata.normalize("NFKC", html.unescape(unquote(value)))) or ""


def array(value):
    if value is None:
        return []
    return json.loads(value) if isinstance(value, str) else value


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def safe_path(root, relative):
    """Accept only a relative resource under the explicitly selected package."""
    relative = Path(relative)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("unsafe package resource path")
    path = (Path(root) / relative).resolve()
    if not path.is_relative_to(Path(root).resolve()):
        raise ValueError("resource escapes package root")
    return path


def empty_result(text, context=None, status="not_found", error=None):
    result = {"schema_version": 1, "query": {"text": text, "language": "en", "context": clean(context)},
              "status": status, "default_entry_id": None, "entries": [], "notices": []}
    if error:
        result["notices"].append({"code": "package_unavailable", "text": error, "entry_id": None})
    return result


def source_order(row):
    """Natural XPath order, not hash/lexicographic order (span[2] before [10])."""
    return tuple(int(x) if x.isdigit() else x for x in re.split(r"(\d+)", row or ""))


class LocalDictionary:
    def __init__(self, package_root, audio_root=None, verify=True):
        self.root = Path(package_root).resolve()
        self.audio_root = Path(audio_root).resolve() if audio_root else None
        self.error = None
        self.audio_error = None
        self.audio_files = set()
        self.connection = None
        try:
            self.manifest = json.loads((self.root / "manifest.json").read_text())
            self.release = self.manifest["data_release"]
            if self.manifest.get("schema_version") != 1:
                raise ValueError("unsupported runtime schema")
            self.prefix = f"longman:{self.release}:"
            db_path = safe_path(self.root, self.manifest.get("database", "runtime.sqlite"))
            if not db_path.is_file():
                raise ValueError("runtime database is missing")
            if verify:
                self._verify_files(self.root, self.manifest)
            self.connection = sqlite3.connect(db_path.as_uri() + "?mode=ro&immutable=1", uri=True)
            self.connection.row_factory = sqlite3.Row
            self.tables = {r[0] for r in self.connection.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
            for table in ("units", "senses", "lookup", "occurrences", "group_map", "groups"):
                if table not in self.tables:
                    raise ValueError(f"runtime table missing: {table}")
            if self.connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("runtime database integrity failure")
            if self.audio_root:
                try:
                    am = json.loads((self.audio_root / "manifest.json").read_text())
                    audio_release = am.get("data_release", am.get("release"))
                    if audio_release != self.release:
                        raise ValueError("audio package release does not match text package")
                    if verify:
                        self._verify_files(self.audio_root, am)
                    self.audio_files = {x["path"] for x in self._file_entries(am)}
                except (OSError, ValueError, KeyError, TypeError) as exc:
                    self.audio_error = str(exc)
                    self.audio_root = None
        except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as exc:
            self.error = str(exc)

    @staticmethod
    def _file_entries(manifest):
        files = manifest.get("files", [])
        if isinstance(files, dict):
            return [dict(v, path=k) if isinstance(v, dict) else {"path": k, "sha256": v} for k, v in files.items()]
        return files

    @classmethod
    def _verify_files(cls, root, manifest):
        files = cls._file_entries(manifest)
        if not files:
            raise ValueError("package file inventory is missing")
        for item in files:
            path = safe_path(root, item["path"])
            if not path.is_file():
                raise ValueError(f"package file is missing: {item['path']}")
            if item.get("sha256") and sha256(path) != item["sha256"]:
                raise ValueError(f"package checksum mismatch: {item['path']}")

    def close(self):
        if self.connection:
            self.connection.close()

    def rows(self, sql, params=()):
        return [dict(x) for x in self.connection.execute(sql, params)]

    def ident(self, kind, raw, scope=None):
        return self.prefix + kind + ":" + (str(scope) + ":" if scope else "") + str(raw)

    def _audio(self, path):
        if not path or not self.audio_root or path not in self.audio_files:
            return None
        return {"kind": "local_file", "location": path} if safe_path(self.audio_root, path).is_file() else None

    def _match_type(self, reason, query, headword):
        if reason == "sense_restricted_query_see_reviewed_query_senses" or reason == "reviewed_source_expression_pattern":
            return "expression_pattern"
        if reason == "source_verified_reference_expansion":
            # These classifications are established by the source's short-form
            # definitions, not by spelling guesses.
            source = self.rows("SELECT s.definition_en FROM senses s JOIN units u ON u.id=s.unit_id WHERE u.headword=?", (query,))
            definitions = " ".join(x["definition_en"] or "" for x in source)
            if re.search(r"past (?:tense|participle)|participle of|plural of|comparative|superlative", definitions, re.I):
                return "inflection"
            if re.search(r"(?:American|British|variant|spelling).*?of|spelling of", definitions, re.I):
                return "spelling_variant"
            return "reference"
        return "exact" if query == headword or reason in ("exact_source_headword", "source_record_article_form", "source_explicit_header_variant") else "reference"

    def _lookup(self, query):
        restrictions = self.rows("SELECT q.*,s.unit_id FROM query_senses q JOIN senses s ON s.id=q.sense_id WHERE q.query_text=?", (query,)) if "query_senses" in self.tables else []
        if restrictions:
            found = defaultdict(list)
            for r in restrictions:
                found[r["unit_id"]].append(r["sense_id"])
            return [(u, "expression_pattern", ss, None) for u, ss in found.items()]
        exact = self.rows("SELECT l.*,u.headword FROM lookup l JOIN units u ON u.id=l.unit_id WHERE l.query_text=?", (query,))
        if exact:
            return [(r["unit_id"], self._match_type(r["reason"], query, r["headword"]), [], None) for r in exact]
        # Source-defined inflections are exported from individual header groups.
        forms = self.rows("SELECT DISTINCT g.unit_id,f.group_id,f.label FROM forms f JOIN groups g ON g.id=f.group_id WHERE f.text=?", (query,)) if "forms" in self.tables else []
        if forms:
            return [(r["unit_id"], "spelling_variant" if "variant" in (r["label"] or "") else "inflection", [], r["group_id"]) for r in forms]
        # Resolved source aliases are one hop; no permissive recursive fallback.
        aliases = self.rows("SELECT DISTINCT l.unit_id FROM aliases a JOIN source_records sr ON sr.record_index=a.target_record JOIN lookup l ON l.query_text=sr.record_key WHERE a.source_key=?", (query,)) if "aliases" in self.tables and "source_records" in self.tables else []
        if aliases:
            return [(r["unit_id"], "reference", [], None) for r in aliases]
        return self._expression_matches(query)

    @staticmethod
    def _verb_candidates(word):
        # Only used as the first token of an already recorded separable pattern;
        # source forms provide irregular verbs. Regular transformations are
        # verified by existence of the candidate pattern before use.
        result = {word}
        if word.endswith("ed"):
            result.update((word[:-2], word[:-1]))
            if len(word) > 4 and word[-3] == word[-4]:
                result.add(word[:-3])
            if word.endswith("ied"):
                result.add(word[:-3] + "y")
        if word.endswith("ing"):
            result.update((word[:-3], word[:-3] + "e"))
            if len(word) > 5 and word[-4] == word[-5]:
                result.add(word[:-4])
        if word.endswith("s"):
            result.add(word[:-1])
            if word.endswith("es"):
                result.add(word[:-2])
        return result

    def _expression_matches(self, query):
        words = query.split()
        if len(words) < 3:
            return []
        verbs = self._verb_candidates(words[0])
        if "forms" in self.tables:
            verbs.update(r["headword"] for r in self.rows("SELECT DISTINCT u.headword FROM forms f JOIN groups g ON g.id=f.group_id JOIN units u ON u.id=g.unit_id WHERE f.text=? AND u.pos='verb'", (words[0],)))
        found = defaultdict(list)
        example_confirmed = defaultdict(list)
        for verb in verbs:
            candidates = self.rows("SELECT s.id,s.unit_id,s.pattern FROM senses s JOIN units u ON u.id=s.unit_id WHERE u.kind='phrasal_verb' AND s.pattern LIKE ?", (verb + " %↔%",))
            for r in candidates:
                pattern = r["pattern"]
                # A recorded object slot and separability arrow are mandatory.
                before, after = pattern.split("↔", 1)
                if not re.search(r"\b(?:somebody|something)\b", before):
                    continue
                fixed_before = re.sub(r"(?:somebody/something|something/somebody|somebody|something)", "", before).strip().split()
                if not fixed_before or fixed_before[0] != verb:
                    continue
                tail_variants = [x.strip().split() for x in after.strip().split("/")]
                for tail in tail_variants:
                    normalized_words = [verb] + words[1:]
                    if tail and normalized_words[:len(fixed_before)] == fixed_before and normalized_words[-len(tail):] == tail and len(words) > len(fixed_before) + len(tail):
                        object_words = words[len(fixed_before):-len(tail)]
                        slot = before[len(verb):]
                        allows_person = "somebody" in slot
                        allows_thing = "something" in slot
                        # Preserve a source's person/thing distinction. In
                        # particular 'look it up' is information retrieval,
                        # never the separate 'visit somebody' meaning.
                        person_pronouns = {"me", "him", "her", "us", "you", "someone", "somebody"}
                        thing_pronouns = {"it", "this", "that", "something"}
                        first_object = object_words[0] if object_words else ""
                        if first_object in thing_pronouns and not allows_thing:
                            continue
                        if first_object in person_pronouns and not allows_person:
                            continue
                        if allows_person and not allows_thing and first_object not in person_pronouns | {"them"} and not first_object[:1].isupper():
                            continue
                        # An NP/pronoun occupies the source's explicit object
                        # slot. Keep all compatible meanings, never the whole
                        # phrasal verb entry by default.
                        found[r["unit_id"]].append(r["id"])
                        phrase = " ".join(normalized_words)
                        for ex in self.rows("SELECT english FROM examples WHERE sense_id=?", (r["id"],)):
                            if re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", ex["english"], re.I):
                                example_confirmed[r["unit_id"]].append(r["id"])
        return [(u, "expression_pattern", sorted(set(example_confirmed.get(u) or ss)), None) for u, ss in found.items()]

    def _source(self, key, locator):
        return {"provider": "longman", "dataset": "LDOCE6EC", "edition": "6", "release": self.release,
                "adapter_version": ADAPTER_VERSION, "delivery": "local", "entry_key": key,
                "locator": clean(locator), "entry_url": None, "retrieved_at": None}

    def _related_query(self, target, containing_headword):
        """Convert an MDX entry/anchor reference into an explicit new query.

        A displayed subexpression label is preferable only when the reviewed
        index confirms it. Otherwise the original source key before # is the
        linked query; the fragment is a source locator, never a query suffix.
        Source references without a usable runtime meaning may still open a
        not_found query, rather than inventing a meaning or losing the link.
        """
        label = canonical(target.get("label") or "")
        if label and self.rows("SELECT 1 FROM lookup WHERE query_text=? LIMIT 1", (label,)):
            return label
        original = canonical(target.get("target") or "")
        base = original.split("#", 1)[0].strip()
        if base:
            return base
        containing = canonical(containing_headword or "")
        if containing and self.rows("SELECT 1 FROM lookup WHERE query_text=? LIMIT 1", (containing,)):
            return containing
        return None

    def _example(self, row, scope):
        return {"id": self.ident("example", row["id"], scope), "english": clean(row["english"]),
                "chinese": clean(row.get("chinese")), "audio": None}

    def _note(self, row, scope):
        en, zh = array(row.get("english_json")), array(row.get("chinese_json"))
        heading = clean(row.get("heading"))
        en_text = clean("\n".join(([heading] if heading else []) + en))
        zh_text = clean("\n".join(zh))
        if not en and not zh:
            # Some source boxes use unwrapped plain prose; preserve it rather
            # than discard known meaning. It is not assigned a fake translation.
            original = clean(row.get("original_text"))
            en_text = original or en_text
        note = {"id": self.ident("note", row["id"], scope), "kind": "grammar" if heading and "grammar" in heading.lower() else "usage",
                "content": {"en": en_text, "zh": zh_text}, "examples": []}
        for ex in self.rows("SELECT * FROM note_examples WHERE note_id=? ORDER BY rowid", (row["id"],)):
            if clean(ex["english"]):
                note["examples"].append(self._example(ex, scope + ":note:" + row["id"]))
        return note

    @staticmethod
    def _labels(row):
        result = []
        for field, kind in (("grammar_json", "grammar"), ("register_json", "register"), ("geography_json", "region")):
            for value in array(row.get(field)):
                if clean(value):
                    item = {"kind": kind, "text": clean(value)}
                    if item not in result:
                        result.append(item)
        return result

    def _sense(self, row, group_id):
        raw_id = row["id"]
        scope = group_id + ":" + raw_id
        sense = {"id": self.ident("sense", raw_id, group_id), "meaning": {"en": clean(row.get("definition_en")), "zh": clean(row.get("definition_zh")) if row.get("bilingual_candidate", 1) else None},
                 "labels": self._labels(row), "patterns": [], "examples": [], "notes": []}
        for construction in self.rows("SELECT c.* FROM constructions c JOIN sense_constructions sc ON sc.construction_id=c.id WHERE sc.sense_id=? ORDER BY c.rowid", (raw_id,)):
            examples = self.rows("SELECT * FROM sense_construction_examples WHERE sense_id=? AND construction_id=? ORDER BY rowid", (raw_id, construction["id"]))
            en = clean("; ".join(array(construction.get("gloss_en_json"))))
            zh = clean("；".join(array(construction.get("explanation_zh_json"))))
            pattern = {"id": self.ident("pattern", construction["id"], scope), "text": construction["pattern"],
                       "explanation": {"en": en, "zh": zh} if en or zh else None,
                       "labels": [], "examples": [self._example(x, scope + ":pattern:" + construction["id"]) for x in examples if clean(x["english"])], "notes": []}
            # Regional/register labels belonging to a construction must remain
            # on it instead of spreading to its parent sense or entry.
            for metadata in array(row.get("scoped_metadata_json")):
                if metadata.get("target_id") == construction["id"]:
                    for key, kind in (("geography", "region"), ("register", "register")):
                        pattern["labels"].extend({"kind": kind, "text": x} for x in metadata.get(key, []) if clean(x))
            sense["patterns"].append(pattern)
        # The source's own expression structure is meaningful even when not
        # duplicated in the constructions table.
        if row.get("pattern") and row["pattern"] != self._current_headword and not any(p["text"] == row["pattern"] for p in sense["patterns"]):
            sense["patterns"].insert(0, {"id": self.ident("pattern", raw_id, scope), "text": row["pattern"], "explanation": None, "labels": [], "examples": [], "notes": []})
        nested = {(x["english"], x["chinese"]) for p in sense["patterns"] for x in p["examples"]}
        for ex in self.rows("SELECT * FROM examples WHERE sense_id=? ORDER BY rowid", (raw_id,)):
            if clean(ex["english"]) and (clean(ex["english"]), clean(ex.get("chinese"))) not in nested:
                sense["examples"].append(self._example(ex, scope))
        for note in self.rows("SELECT n.* FROM notes n JOIN sense_notes sn ON sn.note_id=n.id WHERE sn.sense_id=? ORDER BY n.rowid", (raw_id,)):
            sense["notes"].append(self._note(note, scope))
        if "inline_hints" in self.tables:
            for hint in self.rows("SELECT * FROM inline_hints WHERE sense_id=?", (raw_id,)):
                if clean(hint.get("text_en")) or clean(hint.get("text_zh")):
                    sense["notes"].append({"id": self.ident("hint", raw_id, scope), "kind": "usage", "content": {"en": clean(hint.get("text_en")), "zh": clean(hint.get("text_zh"))}, "examples": []})
        # V1 has no full_forms field: retain necessary complements as explicit
        # source forms on the sense, not an orphaned 'abbreviation of'.
        full_forms = array(row.get("full_forms_json"))
        if full_forms:
            sense["notes"].append({"id": self.ident("fullform", raw_id, scope), "kind": "usage", "content": {"en": "Full form: " + "; ".join(full_forms), "zh": None}, "examples": []})
        metadata = array(row.get("scoped_metadata_json"))
        annotations = array(row.get("usage_annotations_json"))
        if metadata or annotations:
            # Scope is retained verbatim in plain text notes. Do not promote
            # local variant labels to the whole original group.
            pieces = []
            for item in metadata + annotations:
                if isinstance(item, str):
                    pieces.append(item)
                    continue
                subject = clean(item.get("expression") or item.get("variant") or item.get("pattern"))
                labels = []
                for key in ("label", "geography", "register", "text", "text_en", "text_zh", "limits"):
                    value = item.get(key)
                    labels.extend(value if isinstance(value, list) else [value] if value else [])
                relationship = clean(item.get("relationship"))
                if subject:
                    label_text = "; ".join(str(x) for x in labels)
                    pieces.append(subject + (": " + label_text if label_text else "") + (" (" + relationship + ")" if relationship else ""))
                elif labels:
                    pieces.append("; ".join(str(x) for x in labels))
            if pieces:
                sense["notes"].append({"id": self.ident("metadata", raw_id, scope), "kind": "usage", "content": {"en": "\n".join(pieces), "zh": None}, "examples": []})
        return sense

    def _unit_entry(self, unit_id, match_type, restricted, group_filter, query_text=None):
        unit_rows = self.rows("SELECT * FROM units WHERE id=?", (unit_id,))
        if not unit_rows:
            return None
        unit = unit_rows[0]
        explicit_variant = bool(query_text and query_text != unit["headword"] and self.rows("SELECT 1 FROM lookup WHERE query_text=? AND unit_id=? AND reason='source_explicit_header_variant'", (query_text, unit_id)))
        variant_scope = hashlib.sha256(query_text.encode()).hexdigest() if explicit_variant else None
        if explicit_variant:
            match_type = "expression_pattern"
        self._current_headword = unit["headword"]
        senses = self.rows("SELECT * FROM senses WHERE unit_id=? ORDER BY rowid", (unit_id,))
        if restricted:
            senses = [x for x in senses if x["id"] in restricted]
        if not senses:
            return None
        grouped = defaultdict(list)
        group_rows = {}
        for sense in senses:
            mappings = self.rows("SELECT DISTINCT g.* FROM group_map gm JOIN groups g ON g.id=gm.group_id WHERE gm.sense_id=? ORDER BY g.record_index,g.locator", (sense["id"],))
            for group in mappings:
                if group_filter and group["id"] != group_filter:
                    continue
                grouped[group["id"]].append(sense)
                group_rows[group["id"]] = group
        groups = []
        for raw_gid, ss in grouped.items():
            gr = group_rows[raw_gid]
            header = json.loads(gr.get("header_json") or "{}")
            pos = clean(header.get("pos", unit.get("pos")))
            inherited_expression_header = unit["kind"] == "expression" and header.get("source_headword") != unit["headword"]
            if inherited_expression_header:
                pos = None
            normalized_pos = {"phrasal verb": "verb", "number": "numeral", "auxiliary verb": "auxiliary", "modal verb": "modal", "exclamation": "interjection"}.get(pos, pos)
            allowed = {"noun", "verb", "adjective", "adverb", "pronoun", "determiner", "preposition", "conjunction", "interjection", "auxiliary", "modal", "numeral", "particle", "prefix", "suffix", "abbreviation", "symbol", "other", None}
            if normalized_pos not in allowed:
                normalized_pos = "other"
            def ordering(s):
                locations = self.rows("SELECT source_json FROM occurrences WHERE sense_id=? AND record_index=?", (s["id"], gr["record_index"]))
                xpath = json.loads(locations[0]["source_json"]).get("definition_xpath") if locations else None
                if not xpath:
                    mappings = self.rows("SELECT definition_xpath FROM group_map WHERE sense_id=? AND group_id=?", (s["id"], gr["id"]))
                    xpath = mappings[0]["definition_xpath"] if mappings else None
                return source_order(xpath)
            ss.sort(key=ordering)
            pronunciations = []
            if "pronunciations" in self.tables and not explicit_variant:
                for pron in self.rows("SELECT * FROM pronunciations WHERE group_id=? ORDER BY rowid", (raw_gid,)):
                    p = {"region": pron["region"], "ipa": clean(pron.get("ipa")), "audio": self._audio(pron.get("audio_path")), "form_label": clean(pron.get("form_label"))}
                    if p["ipa"] or p["audio"]:
                        if p not in pronunciations:
                            pronunciations.append(p)
            forms = [{"text": f["text"], "label": f["label"] or "source form"} for f in self.rows("SELECT * FROM forms WHERE group_id=? ORDER BY rowid", (raw_gid,))] if "forms" in self.tables else []
            labels = []
            if not inherited_expression_header:
                for label in header.get("labels", []):
                    kind = {"gram": "grammar", "geo": "region", "registerlab": "register", "level": "level", "freq": "frequency"}.get(label.get("class"))
                    if kind and clean(label.get("text")):
                        labels.append({"kind": kind, "text": clean(label["text"])})
            groups.append({"id": self.ident("group", raw_gid, variant_scope), "part_of_speech": normalized_pos, "source_part_of_speech": pos,
                           "pronunciations": pronunciations, "forms": [] if explicit_variant else forms, "labels": labels,
                           "senses": [self._sense(s, raw_gid) for s in ss], "notes": []})
        if not groups:
            return None
        groups.sort(key=lambda x: (group_rows[x["id"].split(":")[-1]]["record_index"], source_order(group_rows[x["id"].split(":")[-1]]["locator"])))
        first = group_rows[groups[0]["id"].split(":")[-1]]
        is_expression = unit["kind"] != "word" or explicit_variant
        origin = "subentry" if is_expression else "headword"
        parent = clean(first.get("parent_headword")) if is_expression else None
        if is_expression and not parent:
            parent = first["record_key"]
        all_sids = [s["id"] for g in groups for s in g["senses"]]
        pattern = next((s["pattern"] for s in senses if s.get("pattern")), None)
        entry = {"id": self.ident("entry", unit_id, variant_scope), "headword": query_text if explicit_variant else unit["headword"], "kind": "expression" if is_expression else "word",
                 "expression_type": "phrasal_verb" if unit["kind"] == "phrasal_verb" else None,
                 "origin": origin, "parent_headword": parent, "source": self._source(first["record_key"], f"record:{first['record_index']}:{first['locator']}"),
                 "match": {"type": match_type, "pattern": query_text if explicit_variant else pattern if match_type == "expression_pattern" else None,
                           "note": "Source header explicitly records this expression variant." if explicit_variant else None, "sense_ids": all_sids if restricted or group_filter or match_type == "expression_pattern" else []},
                 "groups": groups, "notes": [], "related_expressions": []}
        for g in groups:
            for sense in g["senses"]:
                raw_sid = sense["id"].split(":")[-1]
                raw = next(x for x in senses if x["id"] == raw_sid)
                for rel in array(raw.get("relations_json")):
                    for target in rel.get("targets", []):
                        target_text = clean(target.get("label") or rel.get("text"))
                        target_query = self._related_query(target, first["record_key"])
                        if target_text and target_query:
                            item = {"text": target_text, "expression_type": None, "scope_id": sense["id"], "target_query": target_query}
                            if item not in entry["related_expressions"]:
                                entry["related_expressions"].append(item)
        return entry

    def _construction_entries(self, query):
        entries = []
        for row in self.rows("SELECT * FROM constructions WHERE lookup_key=? ORDER BY rowid", (canonical(query).casefold(),)):
            if canonical(row["pattern"]) != canonical(query):
                continue
            en = clean("; ".join(array(row.get("gloss_en_json"))))
            zh = clean("；".join(array(row.get("explanation_zh_json"))))
            if not en and not zh:
                continue  # Mere pattern/examples cannot masquerade as meaning.
            locs = self.rows("SELECT * FROM construction_occurrences WHERE construction_id=? ORDER BY record_index,source_xpath", (row["id"],))
            if not locs or not clean(row.get("parent_headword")):
                continue
            loc = locs[0]
            scope = "construction:" + row["id"]
            examples = self.rows("SELECT DISTINCT id,english,chinese FROM sense_construction_examples WHERE construction_id=? ORDER BY rowid", (row["id"],))
            # Note-box constructions have their own adopted examples, unrelated
            # to any one parent sense; preserve only at the expression itself.
            if "construction_examples" in self.tables:
                examples += self.rows("SELECT * FROM construction_examples WHERE construction_id=? ORDER BY rowid", (row["id"],))
            seen = set()
            ex = []
            for x in examples:
                key = (x["english"], x.get("chinese"))
                if clean(x["english"]) and key not in seen:
                    ex.append(self._example(x, scope))
                    seen.add(key)
            entry_id = self.ident("construction_entry", row["id"])
            sense = {"id": self.ident("construction_sense", row["id"]), "meaning": {"en": en, "zh": zh}, "labels": [], "patterns": [], "examples": ex, "notes": []}
            entries.append({"id": entry_id, "headword": row["pattern"], "kind": "expression", "expression_type": "collocation" if row["kind"] == "collocation" else None,
                            "origin": "note" if row["context_kind"] == "usage_note" else "construction", "parent_headword": row["parent_headword"],
                            "source": self._source(row["parent_headword"], f"record:{loc['record_index']}:{loc['source_xpath']}"),
                            "match": {"type": "exact", "pattern": None, "note": None, "sense_ids": []},
                            "groups": [{"id": self.ident("construction_group", row["id"]), "part_of_speech": None, "source_part_of_speech": None, "pronunciations": [], "forms": [], "labels": [], "senses": [sense], "notes": []}],
                            "notes": [], "related_expressions": []})
        return entries

    def query(self, text, context=None):
        if not isinstance(text, str) or not clean(text):
            raise ValueError("query text must be nonempty")
        if self.error:
            return empty_result(text, context, "unavailable", self.error)
        try:
            query = canonical(text)
            matched = self._lookup(query)
            entries = []
            seen = set()
            for unit_id, match_type, restricted, group_filter in matched:
                entry = self._unit_entry(unit_id, match_type, restricted, group_filter, query)
                if entry and entry["id"] not in seen:
                    entries.append(entry)
                    seen.add(entry["id"])
            if not entries:
                entries = self._construction_entries(query)
            result = empty_result(text, context)
            if not entries:
                return result
            # Source-backed expanded main entry is more useful than a short
            # 'past tense of' stub; preserve both, choose Chinese content first.
            def rank(entry):
                ss = [s for g in entry["groups"] for s in g["senses"]]
                return (not any(s["meaning"]["zh"] for s in ss), entry["match"]["type"] not in ("inflection", "spelling_variant"), entry["match"]["type"] == "exact" and len(ss) == 1 and not ss[0]["meaning"]["zh"])
            entries.sort(key=rank)
            result["entries"] = entries
            result["default_entry_id"] = entries[0]["id"]
            default_senses = [s for g in entries[0]["groups"] for s in g["senses"]]
            result["status"] = "found" if any(s["meaning"]["zh"] for s in default_senses) else "partial"
            for entry in entries:
                english_only = sum(not s["meaning"]["zh"] for g in entry["groups"] for s in g["senses"])
                if english_only:
                    result["notices"].append({"code": "english_only_senses", "text": f"{english_only} 个意思仅英文，原来源未提供可用中文。", "entry_id": entry["id"]})
                raw_senses = {_raw_sense["id"].rsplit(":", 1)[-1] for g in entry["groups"] for _raw_sense in g["senses"]}
                dated = any("dated_encyclopedic_reference" in array(row.get("flags_json")) for sid in raw_senses for row in self.rows("SELECT flags_json FROM senses WHERE id=?", (sid,)))
                if dated:
                    result["notices"].append({"code": "dated_reference", "text": "包含原词典的年代性百科资料，人物身份、日期或背景信息可能已过时。", "entry_id": entry["id"]})
            if self.audio_error:
                result["notices"].append({"code": "audio_package_unavailable", "text": "词头发音包未通过校验，文字和音标仍可用。", "entry_id": None})
            return result
        except (sqlite3.Error, ValueError, KeyError, TypeError, OSError) as exc:
            return empty_result(text, context, "unavailable", f"runtime query failed: {exc}")


def query(package_root, text, audio_root=None, context=None):
    dictionary = LocalDictionary(package_root, audio_root)
    try:
        return dictionary.query(text, context)
    finally:
        dictionary.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--audio-package", type=Path)
    parser.add_argument("--context")
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--no-verify", action="store_true", help="skip inventory checksums (trusted repeated-query measurement only)")
    parser.add_argument("text")
    args = parser.parse_args()
    dictionary = LocalDictionary(args.package, args.audio_package, verify=not args.no_verify)
    result = dictionary.query(args.text, args.context)
    if args.validate:
        from package_semantics import validate_result
        errors = validate_result(result, args.package, args.audio_package)
        if errors:
            parser.exit(2, json.dumps(errors, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    dictionary.close()


if __name__ == "__main__":
    main()
