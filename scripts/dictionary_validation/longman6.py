"""Conservative, source-traceable Longman 6 EC extraction for a private pilot.

Run with a Python that has lxml and readmdict available::

    python longman6.py --source /path/LDOCE6EC.mdx --output /private/path/pilot

Generated dictionary data must stay outside the repository. This does not
install a dictionary, change the application, rewrite definitions, or infer
translations. Ambiguous source structures are retained for review.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote
import argparse
import hashlib
import html as html_entities
import json
import re
import sqlite3
import time
import unicodedata

from lxml import etree, html

from mdict_source import MdictSource


BLOCKED = {"at-link", "buttons", "Tail", "entrymenu"}
NOTE_CLASSES = {"f2nbox", "thesbox", "collobox", "grambox", "grammarbox", "usagebox"}
SKIP_TAGS = {"script", "style", "audio", "source", "img"}
SOURCE = "Longman Dictionary of Contemporary English 6 EC — supplied MDX"


def canonical(value):
    value = unicodedata.normalize("NFKC", html_entities.unescape(unquote(value)))
    return re.sub(r"\s+", " ", value).strip()


def normalize(value):
    return canonical(value).casefold()


def compact(value):
    return re.sub(r"\s+", " ", value).strip()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def classes(node):
    return set(node.get("class", "").split())


def text_of(node, *, omit_tags=(), omit_classes=()):
    """Preserve original inline boundaries: walk<span>ed</span> stays walked."""
    if node is None:
        return ""
    pieces = []
    excluded_tags = SKIP_TAGS | set(omit_tags)
    excluded_classes = BLOCKED | set(omit_classes)

    def walk(element):
        if not isinstance(element.tag, str):
            return
        if element.tag.lower() in excluded_tags or classes(element) & excluded_classes:
            return
        if element.text:
            pieces.append(element.text)
        for child in element:
            walk(child)
            if child.tail:
                pieces.append(child.tail)

    walk(node)
    return compact("".join(pieces))


def unique(values):
    return list(dict.fromkeys(value for value in values if value))


def sound_links(node):
    return unique(
        element.get("href")
        for element in node.iter()
        if isinstance(element.tag, str) and element.get("href", "").startswith("sound://")
    )


def parse_record(markup, source_key, record_index=0, *, reviewed=False):
    tree = html.fragment_fromstring(
        markup, create_parent="div", parser=html.HTMLParser(no_network=True, recover=True)
    )
    review = {"excluded": set(), "quarantined": [], "changes": [], "full_forms": {}, "example_scopes": {}}
    if reviewed:
        from review_repairs import prepare
        review = prepare(tree, source_key)
    state = {}
    ordered = {}
    core_defs = defaultdict(list)
    translations = defaultdict(list)
    examples = defaultdict(list)
    note_nodes = []
    note_examples = defaultdict(list)
    counters = Counter()
    header_cache = {}
    metadata = defaultdict(lambda: defaultdict(list))
    related_fields = defaultdict(list)
    construction_nodes = []
    references = []
    root_tree = tree.getroottree()

    # State is inherited through the actual DOM, never paired by global lists.
    for ordinal, node in enumerate(tree.iter()):
        if not isinstance(node.tag, str):
            continue
        cls = classes(node)
        parent_state = state.get(node.getparent(), (False, None, None, None, False, False))
        blocked, note, scope, owner, in_example, in_definition = parent_state
        blocked = blocked or bool(cls & BLOCKED) or node.tag.lower() in SKIP_TAGS
        if cls & {"entry", "phrvbentry", "runon"}:
            owner = node
            scope = None
        if cls & {"sense", "subsense"}:
            scope = node
        if cls & NOTE_CLASSES and not blocked:
            note = node
            note_nodes.append(node)
        state[node] = (blocked, note, scope, owner, in_example, in_definition)
        ordered[node] = ordinal
        if blocked:
            for name in ["def", "defcn", "example"]:
                if name in cls:
                    counters["excluded_" + name] += 1
            continue
        if cls & {"gramexa", "colloexa", "collocate"}:
            construction_nodes.append(node)
        if "def" in cls:
            counters["usage_def" if note is not None else "core_def"] += 1
            if note is None and node not in review["excluded"]:
                core_defs[scope].append(node)
        if "defcn" in cls:
            counters["usage_defcn" if note is not None else "core_defcn"] += 1
            if note is None and node not in review["excluded"]:
                translations[scope].append(node)
        if "example" in cls:
            counters["usage_example" if note is not None else "core_example"] += 1
            (note_examples[note] if note is not None else examples[review["example_scopes"].get(node, scope)]).append(node)
        if not in_example and not in_definition and note is None:
            for label in ["lexunit", "sensenum", "signpost", "gram", "registerlab", "geo"]:
                if label in cls:
                    metadata[scope][label].append(node)
            if cls & {"fullform", "crossref", "syn", "opp", "thesref"}:
                related_fields[scope].append(node)
        # Children need the current element's field boundaries.
        state[node] = (
            blocked, note, scope, owner,
            in_example or "example" in cls,
            in_definition or "def" in cls or "defcn" in cls,
        )
        if node.tag.lower() == "a" and node.get("href", "").startswith("entry://"):
            references.append({"target": node.get("href")[8:], "label": text_of(node)})

    def path(node):
        return root_tree.getpath(node) if node is not None else None

    def scopes_for(scope):
        result = []
        node = scope
        owner = state[scope][3] if scope is not None else None
        while node is not None:
            if classes(node) & {"sense", "subsense"}:
                if owner is not None and state[node][3] is not owner:
                    break
                result.append(node)
            node = node.getparent()
        return result

    def owned_header(owner):
        if owner is None:
            return None
        if owner in header_cache:
            return header_cache[owner]
        header = next((
            node for node in owner.iter()
            if isinstance(node.tag, str) and "entryhead" in classes(node)
            and not state[node][0] and state[node][3] is owner
        ), None)
        header_cache[owner] = header
        return header

    def header_fields(owner):
        if owner is not None and "runon" in classes(owner):
            title = next((n for n in owner.iter() if "deriv" in classes(n) and not state[n][0]), None)
            pos = next((text_of(n) for n in owner.iter() if "pos" in classes(n) and not state[n][0]), None)
            headword = text_of(title).lstrip("—– ") if title is not None else None
            return {
                "headword": headword, "pattern": headword, "pos": pos,
                "grammar": unique(text_of(n) for n in owner.iter() if "gram" in classes(n) and not state[n][0]),
            }
        header = owned_header(owner)
        if header is None:
            return {"headword": None, "pos": None, "pattern": None, "grammar": []}
        candidates = [
            n for n in header.iter()
            if isinstance(n.tag, str) and not state[n][0]
            and classes(n) & {"hwd", "phrvbhwd"}
        ]
        title = candidates[0] if candidates else None
        pos = next((text_of(n) for n in header.iter() if "pos" in classes(n) and not state[n][0]), None)
        return {
            "headword": text_of(title, omit_classes={"object"}) if title is not None else None,
            "pattern": text_of(title) if title is not None else None,
            "pos": pos,
            "grammar": unique(text_of(n) for n in header.iter() if "gram" in classes(n) and not state[n][0]),
        }

    def unit_for(scope):
        owner = state[scope][3] if scope is not None else None
        header = header_fields(owner)
        ancestors = scopes_for(scope)
        expression = next((
            text_of(node) for ancestor in ancestors for node in metadata[ancestor]["lexunit"]
            if text_of(node)
        ), None)
        pv = owner is not None and "phrvbentry" in classes(owner)
        if owner is not None and "runon" in classes(owner):
            kind, headword, pos = "derivative", header["headword"], header["pos"]
        elif pv:
            kind, headword, pos = "phrasal_verb", header["headword"], header["pos"]
        elif expression:
            # lexunit does not reliably distinguish idioms from other phrases.
            kind, headword, pos = "expression", expression, None
        else:
            kind, headword, pos = "word", header["headword"], header["pos"]
        trusted_header = bool(headword)
        headword = headword or source_key
        unit = {
            "headword": headword, "kind": kind, "part_of_speech": pos,
            "source_header_present": trusted_header,
        }
        # Case-folding is for lookup only: kt/Kt and us/US can differ in meaning.
        unit["id"] = digest([kind, canonical(headword), canonical(pos or "")])
        return unit, header, expression, ancestors

    def related_for(scope):
        full_forms = []
        relations = []
        for ancestor in reversed(scopes_for(scope)):
            full_forms.extend(review["full_forms"].get(ancestor, []))
            for node in related_fields[ancestor]:
                cls = classes(node)
                if "fullform" in cls:
                    full_forms.append(text_of(node))
                    continue
                kind = next(k for k in ["crossref", "syn", "opp", "thesref"] if k in cls)
                relations.append({
                    "kind": kind, "text": text_of(node),
                    "targets": [
                        {"target": n.get("href")[8:], "label": text_of(n)}
                        for n in node.iter()
                        if n.tag == "a" and n.get("href", "").startswith("entry://")
                    ],
                })
        return unique(full_forms), relations

    def parse_example(node):
        english_nodes = [
            n for n in node.iter() if isinstance(n.tag, str) and n.tag.lower() == "expen"
            and next((a for a in n.iterancestors() if "example" in classes(a)), None) is node
        ]
        chinese_nodes = [
            n for n in node.iter() if isinstance(n.tag, str) and n.tag.lower() == "expcn"
            and next((a for a in n.iterancestors() if "example" in classes(a)), None) is node
        ]
        issues = []
        if len(english_nodes) > 1 or len(chinese_nodes) > 1:
            issues.append("multiple_example_segments")
        if english_nodes:
            english = compact(" ".join(text_of(n) for n in english_nodes))
        else:
            english = text_of(node, omit_tags={"expcn"}, omit_classes={"defcn", "gramcn"})
            english = re.sub(r"^[·•]\s*", "", english)
            if re.search(r"[\u3400-\u9fff]", english):
                issues.append("unwrapped_bilingual_example")
        chinese = compact(" ".join(text_of(n) for n in chinese_nodes)) or None
        if not english:
            issues.append("empty_example_english")
        patterns = []
        for parent in node.iterancestors():
            if classes(parent) & {"sense", "subsense"}:
                break
            if classes(parent) & {"gramexa", "colloexa", "collocate"}:
                patterns = unique(
                    text_of(n) for n in parent.iter()
                    if classes(n) & {"propform", "propformprep", "collo"}
                    and not any("example" in classes(a) for a in n.iterancestors() if a is not parent)
                )
                break
        return {
            "english": english, "chinese": chinese, "patterns": patterns,
            "audio": sound_links(node), "source_xpath": path(node), "issues": issues,
        }

    notes = []
    for node in note_nodes:
        note_owner = state[node][3]
        heading = next((text_of(n) for n in node.iter() if classes(n) & {"heading", "boxheading"}), "")
        english = unique(text_of(n, omit_classes={"example"}) for n in node.iter() if isinstance(n.tag, str) and n.tag.lower() == "explen")
        chinese = unique(text_of(n, omit_classes={"example"}) for n in node.iter() if isinstance(n.tag, str) and n.tag.lower() == "explcn")
        note = {
            "heading": heading, "english": english, "chinese": chinese,
            "original_text": text_of(node),
            "examples": [parse_example(n) for n in note_examples[node]],
            "source_xpath": path(node), "source_scope_xpath": path(state[node][2]),
            "_scope": state[node][2], "_owner": note_owner,
        }
        note["id"] = digest([heading, english, chinese, note["original_text"]])
        notes.append(note)

    # A phrase may be supplied as a collocation/gloss rather than a lexunit.
    # Preserve its own explanation and examples, separately from a full sense.
    constructions = []
    construction_scopes = defaultdict(list)
    for node in construction_nodes:
        def belongs(candidate):
            return next((a for a in candidate.iterancestors() if classes(a) & {"gramexa", "colloexa", "collocate"}), None) is node

        def outside_example(candidate):
            return not any("example" in classes(a) for a in candidate.iterancestors() if a is not node)

        pattern_nodes = [
            n for n in node.iter() if classes(n) & {"propform", "propformprep", "collo"}
            and belongs(n) and outside_example(n)
        ]
        pattern = compact(" / ".join(unique(text_of(n, omit_classes={"geo"}) for n in pattern_nodes)))
        if not pattern:
            continue
        scope, owner, note = state[node][2], state[node][3], state[node][1]
        header = header_fields(owner)
        item = {
            "pattern": pattern,
            "kind": "grammar_pattern" if "gramexa" in classes(node) else "collocation",
            "gloss_en": unique(text_of(n) for n in node.iter() if classes(n) & {"gloss", "collgloss"} and belongs(n) and outside_example(n)),
            "explanation_zh": unique(text_of(n) for n in node.iter() if classes(n) & {"gramcn", "collocn"} and belongs(n) and outside_example(n)),
            "parent_headword": header["headword"],
            "context_kind": "usage_note" if note is not None else "sense",
            "examples": [parse_example(n) for n in node.iter() if "example" in classes(n) and belongs(n)],
            "source_xpath": path(node), "source_scope_xpath": path(scope),
            "source_header_present": bool(header["headword"]),
        }
        item["id"] = digest([item["pattern"], item["kind"], item["gloss_en"], item["explanation_zh"], item["parent_headword"], item["context_kind"]])
        constructions.append(item)
        if note is None:
            construction_scopes[scope].append(item["id"])

    # Run-ons provide examples of a derived form without their own definition.
    # Preserve that relationship rather than borrowing the base word's meaning.
    derivatives = []
    derivative_nodes = defaultdict(list)
    layout_repairs = []
    for scope, nodes in list(examples.items()):
        remaining = []
        for node in nodes:
            owner = state[node][3]
            if owner is not None and "runon" in classes(owner) and not core_defs.get(scope):
                derivative_nodes[owner].append(node)
                continue
            # A few source pages close subsense b) before its trailing examples.
            # Only repair when the previous subsense explicitly ends in a colon.
            target = None
            if not core_defs.get(scope) and scope is not None and node.getparent() is scope:
                previous = node.getprevious()
                while previous is not None and "example" in classes(previous):
                    previous = previous.getprevious()
                if previous is not None and "subsense" in classes(previous):
                    if len(core_defs.get(previous, [])) == 1 and text_of(previous).rstrip().endswith((":", "：")):
                        target = previous
            if target is not None:
                examples[target].append(node)
                layout_repairs.append({
                    "rule": "trailing_examples_after_closed_subsense_colon",
                    "example_xpath": path(node), "original_scope_xpath": path(scope),
                    "repaired_scope_xpath": path(target),
                })
            else:
                remaining.append(node)
        examples[scope] = remaining
    for owner, nodes in derivative_nodes.items():
        header = header_fields(owner)
        parent = next((a for a in owner.iterancestors() if "entry" in classes(a) and not state[a][0]), None)
        parent_fields = header_fields(parent)
        item = {
            "headword": header["headword"], "part_of_speech": header["pos"],
            "grammar": header["grammar"], "parent_headword": parent_fields["headword"],
            "definition_status": "not_independently_defined_in_source",
            "examples": [parse_example(n) for n in nodes], "source_xpath": path(owner),
        }
        item["id"] = digest([item["headword"], item["part_of_speech"], item["parent_headword"], item["grammar"]])
        derivatives.append(item)

    senses = []
    quarantined = list(review["quarantined"])
    used_examples = set()
    used_translations = set()
    for scope, definitions in core_defs.items():
        if scope is None or len(definitions) != 1:
            quarantined.append({
                "reason": "missing_scope" if scope is None else "multiple_definitions_in_scope",
                "source_scope_xpath": path(scope),
                "definition_count": len(definitions),
                "definitions": [text_of(n) for n in definitions],
                "translations": [text_of(n) for n in translations[scope]],
                "examples": [parse_example(n) for n in examples[scope]],
            })
            used_examples.update(examples[scope]); used_translations.update(translations[scope])
            continue
        definition = definitions[0]
        unit, header, expression, ancestors = unit_for(scope)
        cn_nodes = translations[scope]
        nonempty_cn = [text_of(n) for n in cn_nodes if text_of(n)]
        english = text_of(definition)
        full_forms, relations = related_for(scope)
        if not unit["source_header_present"] or not english:
            quarantined.append({
                "reason": "missing_unit_header" if not unit["source_header_present"] else "empty_definition_english",
                "source_scope_xpath": path(scope), "definition_count": 1,
                "definitions": [english], "translations": [text_of(n) for n in cn_nodes],
                "full_forms": full_forms, "relations": relations,
                "examples": [parse_example(n) for n in examples[scope]],
            })
            used_examples.update(examples[scope]); used_translations.update(cn_nodes)
            continue
        issues = []
        if len(cn_nodes) > 1:
            issues.append("multiple_translation_nodes")
        if not nonempty_cn:
            issues.append("missing_definition_chinese")
        if english.rstrip().endswith("abbreviation of") and not full_forms:
            issues.append("incomplete_abbreviation_reference")
        # These two source records have their Chinese translations interchanged.
        # Keep the supplied strings for evidence; do not silently rewrite them.
        if (source_key, nonempty_cn, full_forms) in [
            ("kt", ["爵士"], ["knot"]), ("Kt", ["节"], ["knight"]),
        ]:
            issues.append("reviewed_source_translation_mismatch")
        value_examples = [parse_example(n) for n in examples[scope]]
        if any(e["issues"] for e in value_examples):
            issues.append("example_structure_needs_review")
        owner = state[scope][3]
        grammar = unique(
            [text_of(n) for a in reversed(ancestors) for n in metadata[a]["gram"]]
            + (header["grammar"] if unit["kind"] in {"word", "phrasal_verb", "derivative"} else [])
        )
        register = unique(text_of(n) for a in reversed(ancestors) for n in metadata[a]["registerlab"])
        signpost = unique(text_of(n) for a in reversed(ancestors) for n in metadata[a]["signpost"])
        geography = unique(text_of(n) for a in reversed(ancestors) for n in metadata[a]["geo"])
        numbers = [text_of(n) for a in reversed(ancestors) for n in metadata[a]["sensenum"]]
        related_notes = [
            note["id"] for note in notes
            if note["_owner"] is owner and (
                note["_scope"] in ancestors or note["_scope"] is None
            )
        ]
        chinese = nonempty_cn[0] if len(nonempty_cn) == 1 else None
        anchors = unique(
            n.get("name") for n in scope.iter()
            if isinstance(n.tag, str) and n.tag.lower() == "a" and n.get("name")
            and state[n][2] is scope
        )
        eligible = not (set(issues) & {
            "multiple_translation_nodes", "missing_unit_header", "empty_definition_english",
            "example_structure_needs_review",
            "reviewed_source_translation_mismatch", "incomplete_abbreviation_reference",
        })
        sense = {
            "unit": unit, "definition_en": english, "definition_zh": chinese,
            "source_translation_fragments": [text_of(n) for n in cn_nodes],
            "expression_pattern": expression or header["pattern"],
            "grammar": grammar, "register": register, "signpost": signpost,
            "geography": geography, "full_forms": full_forms, "relations": relations,
            "source_sense_numbers": numbers, "examples": value_examples,
            "usage_note_ids": unique(related_notes), "issues": issues, "eligible": eligible,
            "construction_ids": unique(construction_scopes[scope]),
            "source": {
                "record_key": source_key, "record_index": record_index,
                "scope_xpath": path(scope), "definition_xpath": path(definition),
                "translation_xpaths": [path(n) for n in cn_nodes], "anchors": anchors,
            },
        }
        sense["id"] = digest([
            unit["id"], english, chinese, sense["expression_pattern"], grammar, register,
            signpost, geography, full_forms, relations,
        ])
        senses.append(sense)
        used_examples.update(examples[scope]); used_translations.update(cn_nodes)

    for scope, nodes in examples.items():
        unassigned = [n for n in nodes if n not in used_examples]
        if unassigned:
            quarantined.append({
                "reason": "examples_without_owned_definition",
                "source_scope_xpath": path(scope), "definition_count": 0,
                "examples": [parse_example(n) for n in unassigned],
            })
    for scope, nodes in translations.items():
        unassigned = [n for n in nodes if n not in used_translations]
        if unassigned:
            quarantined.append({
                "reason": "translations_without_owned_definition",
                "source_scope_xpath": path(scope), "definition_count": 0,
                "translations": [text_of(n) for n in unassigned],
            })
    for note in notes:
        del note["_scope"]; del note["_owner"]
    return {
        "source_key": source_key, "record_index": record_index,
        "senses": senses, "notes": notes, "derivatives": derivatives,
        "layout_repairs": layout_repairs, "quarantined": quarantined,
        "constructions": constructions,
        "source_counts": dict(counters), "references": references,
        "reviewed_changes": review["changes"],
    }


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE units(id TEXT PRIMARY KEY,headword TEXT NOT NULL,lookup_key TEXT NOT NULL,kind TEXT NOT NULL,pos TEXT);
CREATE INDEX units_lookup ON units(lookup_key);
CREATE TABLE senses(id TEXT PRIMARY KEY,unit_id TEXT REFERENCES units(id),definition_en TEXT NOT NULL,definition_zh TEXT,pattern TEXT,grammar_json TEXT,register_json TEXT,signpost_json TEXT,geography_json TEXT,full_forms_json TEXT,relations_json TEXT,issues_json TEXT,eligible INTEGER NOT NULL);
CREATE INDEX senses_unit ON senses(unit_id);
CREATE TABLE examples(id TEXT PRIMARY KEY,sense_id TEXT REFERENCES senses(id),english TEXT NOT NULL,chinese TEXT,patterns_json TEXT,audio_json TEXT,issues_json TEXT);
CREATE INDEX examples_sense ON examples(sense_id);
CREATE TABLE notes(id TEXT PRIMARY KEY,heading TEXT,english_json TEXT,chinese_json TEXT,original_text TEXT NOT NULL);
CREATE TABLE note_examples(id TEXT PRIMARY KEY,note_id TEXT REFERENCES notes(id),english TEXT NOT NULL,chinese TEXT,issues_json TEXT);
CREATE TABLE sense_notes(sense_id TEXT REFERENCES senses(id),note_id TEXT REFERENCES notes(id),PRIMARY KEY(sense_id,note_id));
CREATE TABLE constructions(id TEXT PRIMARY KEY,pattern TEXT NOT NULL,lookup_key TEXT NOT NULL,kind TEXT NOT NULL,gloss_en_json TEXT,explanation_zh_json TEXT,parent_headword TEXT,context_kind TEXT,source_header_present INTEGER NOT NULL);
CREATE INDEX constructions_lookup ON constructions(lookup_key);
CREATE TABLE construction_examples(id TEXT PRIMARY KEY,construction_id TEXT REFERENCES constructions(id),english TEXT NOT NULL,chinese TEXT);
CREATE TABLE construction_occurrences(construction_id TEXT REFERENCES constructions(id),record_index INTEGER NOT NULL,source_xpath TEXT NOT NULL,source_scope_xpath TEXT,PRIMARY KEY(construction_id,record_index,source_xpath));
CREATE TABLE sense_constructions(sense_id TEXT REFERENCES senses(id),construction_id TEXT REFERENCES constructions(id),PRIMARY KEY(sense_id,construction_id));
CREATE TABLE derivative_contexts(id TEXT PRIMARY KEY,headword TEXT,pos TEXT,parent_headword TEXT,grammar_json TEXT,definition_status TEXT NOT NULL);
CREATE TABLE derivative_examples(id TEXT PRIMARY KEY,derivative_id TEXT REFERENCES derivative_contexts(id),english TEXT NOT NULL,chinese TEXT,audio_json TEXT,issues_json TEXT);
CREATE TABLE derivative_occurrences(derivative_id TEXT REFERENCES derivative_contexts(id),record_index INTEGER,source_xpath TEXT,PRIMARY KEY(derivative_id,record_index,source_xpath));
CREATE TABLE occurrences(sense_id TEXT REFERENCES senses(id),record_index INTEGER NOT NULL,record_key TEXT NOT NULL,source_json TEXT NOT NULL,PRIMARY KEY(sense_id,record_index,source_json));
CREATE INDEX occurrences_record ON occurrences(record_index);
CREATE TABLE example_occurrences(example_id TEXT REFERENCES examples(id),record_index INTEGER,source_xpath TEXT,PRIMARY KEY(example_id,record_index,source_xpath));
CREATE TABLE source_records(record_index INTEGER PRIMARY KEY,record_key TEXT NOT NULL,record_type TEXT NOT NULL,redirect_target TEXT,core_defs INTEGER NOT NULL,core_examples INTEGER NOT NULL,quarantine_count INTEGER NOT NULL);
CREATE TABLE record_units(record_index INTEGER,unit_id TEXT REFERENCES units(id),PRIMARY KEY(record_index,unit_id));
CREATE TABLE aliases(query TEXT NOT NULL,source_key TEXT NOT NULL,target_key TEXT NOT NULL,target_record INTEGER,match_kind TEXT NOT NULL);
CREATE INDEX alias_lookup ON aliases(query);
CREATE TABLE source_references(record_index INTEGER NOT NULL,references_json TEXT NOT NULL);
CREATE TABLE correction_log(record_index INTEGER NOT NULL,record_key TEXT NOT NULL,change_json TEXT NOT NULL);
"""


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def store_record(connection, result):
    index, key = result["record_index"], result["source_key"]
    for change in result["reviewed_changes"]:
        connection.execute("INSERT INTO correction_log VALUES(?,?,?)", (index, key, encoded(change)))
    if result["references"]:
        connection.execute("INSERT INTO source_references VALUES(?,?)", (index, encoded(result["references"])))
    for item in result["constructions"]:
        connection.execute("INSERT OR IGNORE INTO constructions VALUES(?,?,?,?,?,?,?,?,?)", (
            item["id"], item["pattern"], normalize(item["pattern"]), item["kind"],
            encoded(item["gloss_en"]), encoded(item["explanation_zh"]),
            item["parent_headword"], item["context_kind"], int(item["source_header_present"]),
        ))
        connection.execute("INSERT OR IGNORE INTO construction_occurrences VALUES(?,?,?,?)", (
            item["id"], index, item["source_xpath"], item["source_scope_xpath"],
        ))
        for example in item["examples"]:
            identifier = digest([item["id"], example["english"], example["chinese"]])
            connection.execute("INSERT OR IGNORE INTO construction_examples VALUES(?,?,?,?)", (
                identifier, item["id"], example["english"], example["chinese"],
            ))
    for item in result["derivatives"]:
        connection.execute("INSERT OR IGNORE INTO derivative_contexts VALUES(?,?,?,?,?,?)", (
            item["id"], item["headword"], item["part_of_speech"], item["parent_headword"],
            encoded(item["grammar"]), item["definition_status"],
        ))
        connection.execute("INSERT OR IGNORE INTO derivative_occurrences VALUES(?,?,?)", (
            item["id"], index, item["source_xpath"],
        ))
        for example in item["examples"]:
            identifier = digest([item["id"], example["english"], example["chinese"]])
            connection.execute("INSERT OR IGNORE INTO derivative_examples VALUES(?,?,?,?,?,?)", (
                identifier, item["id"], example["english"], example["chinese"],
                encoded(example["audio"]), encoded(example["issues"]),
            ))
    for note in result["notes"]:
        connection.execute("INSERT OR IGNORE INTO notes VALUES(?,?,?,?,?)", (
            note["id"], note["heading"], encoded(note["english"]), encoded(note["chinese"]), note["original_text"]
        ))
        for example in note["examples"]:
            identifier = digest([note["id"], example["english"], example["chinese"]])
            connection.execute("INSERT OR IGNORE INTO note_examples VALUES(?,?,?,?,?)", (
                identifier, note["id"], example["english"], example["chinese"], encoded(example["issues"])
            ))
    for sense in result["senses"]:
        unit = sense["unit"]
        connection.execute("INSERT OR IGNORE INTO units VALUES(?,?,?,?,?)", (
            unit["id"], unit["headword"], normalize(unit["headword"]), unit["kind"], unit["part_of_speech"]
        ))
        connection.execute("INSERT OR IGNORE INTO senses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            sense["id"], unit["id"], sense["definition_en"], sense["definition_zh"], sense["expression_pattern"],
            encoded(sense["grammar"]), encoded(sense["register"]), encoded(sense["signpost"]),
            encoded(sense["geography"]), encoded(sense["full_forms"]), encoded(sense["relations"]),
            encoded(sense["issues"]), int(sense["eligible"]),
        ))
        connection.execute("INSERT OR IGNORE INTO record_units VALUES(?,?)", (index, unit["id"]))
        connection.execute("INSERT OR IGNORE INTO occurrences VALUES(?,?,?,?)", (
            sense["id"], index, key, encoded(sense["source"])
        ))
        for example in sense["examples"]:
            identifier = digest([sense["id"], example["english"], example["chinese"], example["patterns"]])
            connection.execute("INSERT OR IGNORE INTO examples VALUES(?,?,?,?,?,?,?)", (
                identifier, sense["id"], example["english"], example["chinese"], encoded(example["patterns"]),
                encoded(example["audio"]), encoded(example["issues"]),
            ))
            connection.execute("INSERT OR IGNORE INTO example_occurrences VALUES(?,?,?)", (
                identifier, index, example["source_xpath"]
            ))
        for note in sense["usage_note_ids"]:
            connection.execute("INSERT OR IGNORE INTO sense_notes VALUES(?,?)", (sense["id"], note))
        for construction in sense["construction_ids"]:
            connection.execute("INSERT OR IGNORE INTO sense_constructions VALUES(?,?)", (sense["id"], construction))


def build(source_path, output, *, reviewed=False):
    output.mkdir(parents=True, exist_ok=True)
    database = output / "longman6-clean-pilot.sqlite"
    if database.exists():
        raise FileExistsError(f"Use a fresh output directory: {database}")
    source = MdictSource(source_path)
    source_hash = hashlib.sha256(Path(source_path).read_bytes()).hexdigest()
    if reviewed:
        from review_repairs import SOURCE_SHA256
        if source_hash != SOURCE_SHA256:
            raise ValueError("Reviewed repairs are only valid for the fingerprinted source")
    connection = sqlite3.connect(database)
    connection.executescript(SCHEMA)
    totals = Counter(); issues = Counter(); quarantine_reasons = Counter()
    started = time.monotonic()
    trace = (output / "review-queue.jsonl").open("w")
    for index, (_, key) in enumerate(source.keys):
        text = source.text(index)
        if text.startswith("@@@LINK="):
            connection.execute("INSERT INTO source_records VALUES(?,?,?,?,?,?,?)", (
                index, key, "redirect", text[8:].strip(), 0, 0, 0
            ))
            totals["redirect_records"] += 1
            continue
        result = parse_record(text, key, index, reviewed=reviewed)
        totals.update(result["source_counts"])
        totals["body_records"] += 1
        totals["sense_observations"] += len(result["senses"])
        totals["translation_node_observations"] += sum(len(s["source_translation_fragments"]) for s in result["senses"])
        totals["quarantined_translation_nodes"] += sum(len(q.get("translations", [])) for q in result["quarantined"])
        totals["main_example_observations"] += sum(len(s["examples"]) for s in result["senses"])
        totals["usage_example_observations"] += sum(len(n["examples"]) for n in result["notes"])
        totals["derivative_example_observations"] += sum(len(n["examples"]) for n in result["derivatives"])
        totals["source_layout_repairs"] += len(result["layout_repairs"])
        totals["reviewed_changes"] += len(result["reviewed_changes"])
        totals["construction_observations"] += len(result["constructions"])
        totals["quarantined_definition_nodes"] += sum(q.get("definition_count", 0) for q in result["quarantined"])
        totals["quarantined_main_examples"] += sum(len(q.get("examples", [])) for q in result["quarantined"])
        for sense in result["senses"]:
            issues.update(sense["issues"])
            if sense["issues"]:
                trace.write(encoded({"record_key": key, "record_index": index, "type": "sense_issues", "sense": sense}) + "\n")
        for entry in result["quarantined"]:
            quarantine_reasons[entry["reason"]] += 1
            trace.write(encoded({"record_key": key, "record_index": index, "type": "quarantine", **entry}) + "\n")
        for repair in result["layout_repairs"]:
            trace.write(encoded({"record_key": key, "record_index": index, "type": "source_layout_repair", **repair}) + "\n")
        for repair in result["reviewed_changes"]:
            trace.write(encoded({"record_key": key, "record_index": index, "type": "reviewed_correction", **repair}) + "\n")
        if not result["senses"]:
            totals["body_records_without_exported_senses"] += 1
            trace.write(encoded({"record_key": key, "record_index": index, "type": "reference_or_unhandled", "references": result["references"]}) + "\n")
        store_record(connection, result)
        connection.execute("INSERT INTO source_records VALUES(?,?,?,?,?,?,?)", (
            index, key, "content" if result["senses"] else "derivative_context" if result["derivatives"] else "reference_or_unhandled", None,
            result["source_counts"].get("core_def", 0), result["source_counts"].get("core_example", 0),
            len(result["quarantined"]),
        ))
        if index and index % 5000 == 0:
            connection.commit()
            print(f"Extracted {index}/{len(source.keys)} source records ({time.monotonic()-started:.1f}s)", flush=True)
    trace.close()
    connection.commit()
    for block in range(len(source.blocks)):
        source.block(block)
    # Index only source-declared keys; do not invent morphology or phrase matches.
    raw = defaultdict(list); folded = defaultdict(list)
    for index, (_, key) in enumerate(source.keys):
        raw[key].append(index); folded[normalize(key)].append(index)
    unresolved = []
    redirect_repairs = []
    for index, (_, key) in enumerate(source.keys):
        row = connection.execute("SELECT record_type,redirect_target FROM source_records WHERE record_index=?", (index,)).fetchone()
        if row[0] != "redirect":
            continue
        target = row[1]
        ids = raw.get(target) or folded.get(normalize(target))
        match_kind = "source_redirect"
        if not ids and reviewed and target.endswith(", the"):
            base = target[:-5]
            for candidate in ["the " + base, base]:
                ids = raw.get(candidate)
                if ids:
                    match_kind = "reviewed_source_redirect_article"
                    redirect_repairs.append({"query": key, "original_target": target, "resolved_key": candidate})
                    break
        if not ids:
            unresolved.append({"query": key, "target": target})
        for target_index in ids or [None]:
            connection.execute("INSERT INTO aliases VALUES(?,?,?,?,?)", (normalize(key), key, target, target_index, match_kind))
    counts = {}
    for table in ["units", "senses", "examples", "notes", "note_examples", "derivative_contexts", "derivative_examples", "constructions", "construction_examples", "occurrences", "source_records", "aliases"]:
        counts[table] = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    counts["eligible_senses"] = connection.execute("SELECT COUNT(*) FROM senses WHERE eligible=1").fetchone()[0]
    counts["senses_with_chinese"] = connection.execute("SELECT COUNT(*) FROM senses WHERE definition_zh IS NOT NULL").fetchone()[0]
    counts["examples_with_chinese"] = connection.execute("SELECT COUNT(*) FROM examples WHERE chinese IS NOT NULL").fetchone()[0]
    conflicts = connection.execute("""
        SELECT u.headword,s.definition_en,COUNT(DISTINCT s.definition_zh) n
        FROM senses s JOIN units u ON u.id=s.unit_id WHERE s.definition_zh IS NOT NULL
        GROUP BY s.unit_id,s.definition_en HAVING n>1
    """).fetchall()
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    conservation = {
        "definitions": totals["core_def"] == totals["sense_observations"] + totals["quarantined_definition_nodes"],
        "translation_nodes": totals["core_defcn"] == totals["translation_node_observations"] + totals["quarantined_translation_nodes"],
        "main_examples": totals["core_example"] == totals["main_example_observations"] + totals["derivative_example_observations"] + totals["quarantined_main_examples"],
        "usage_examples": totals["usage_example"] == totals["usage_example_observations"],
        "records": len(source.keys) == totals["body_records"] + totals["redirect_records"],
    }
    if not all(conservation.values()):
        raise ValueError(f"Source field conservation failed: {conservation}")
    manifest = {
        "provider": SOURCE, "source_path": str(source_path), "source_sha256": source_hash,
        "source_bytes": Path(source_path).stat().st_size, "source_records": len(source.keys),
        "reviewed_repairs_enabled": reviewed, "reviewed_redirect_repairs": redirect_repairs,
        "validated_mdx_blocks": len(source.validated_blocks), "totals": dict(totals),
        "database_counts": counts, "sense_issues": dict(issues), "quarantine_reasons": dict(quarantine_reasons),
        "unresolved_source_redirects": unresolved,
        "translation_conflict_candidates": [{"headword": r[0], "definition_en": r[1], "variants": r[2]} for r in conflicts],
        "sqlite_integrity": integrity, "foreign_key_errors": foreign_keys,
        "source_field_conservation": conservation,
        "seconds": round(time.monotonic() - started, 2),
        "scope": "private validation; no application integration or distribution authorization",
    }
    for key, value in {"provider": SOURCE, "source_sha256": source_hash, "format": "longman6-reviewed-v5" if reviewed else "longman6-validation-v4"}.items():
        connection.execute("INSERT INTO metadata VALUES(?,?)", (key, value))
    connection.commit(); connection.close(); source.close()
    (output / "validation.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(encoded(manifest), flush=True)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reviewed", action="store_true", help="Apply guarded, evidenced repairs for this exact source")
    arguments = parser.parse_args()
    build(arguments.source, arguments.output, reviewed=arguments.reviewed)
