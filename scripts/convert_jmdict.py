#!/usr/bin/env python3
"""Convert JMdict_e.xml to a TSV file for LexiCue built-in Japanese dictionary.

Usage:
    python3 convert_jmdict.py --input JMdict_e.xml --output jmdict.tsv
    gzip -9 jmdict.tsv   # → jmdict.tsv.gz

Output TSV columns (tab-separated):
    lemma         The searchable form (kanji or reading)
    reading       Kana pronunciation
    translation   English glosses (semicolon-separated)
    part_of_speech JMdict POS tags (comma-separated, deduplicated)

Strategy: one row per (kanji, reading) pair, plus reading-only rows for kana lookup.
"""

import argparse
import sys
import xml.etree.ElementTree as ET


def parse_args():
    parser = argparse.ArgumentParser(description="Convert JMdict XML to LexiCue TSV")
    parser.add_argument("--input", required=True, help="Path to JMdict_e.xml")
    parser.add_argument("--output", required=True, help="Path to output TSV file")
    return parser.parse_args()


def extract_glosses(sense_elem):
    glosses = []
    for gloss in sense_elem.findall("gloss"):
        text = (gloss.text or "").strip()
        if text:
            glosses.append(text)
    return glosses


def extract_pos(sense_elem):
    pos_tags = []
    for pos in sense_elem.findall("pos"):
        text = (pos.text or "").strip()
        if text:
            pos_tags.append(text)
    return pos_tags


def get_sense_restrictions(sense_elem):
    """Return (stagk_set, stagr_set) or None if unrestricted."""
    stagk = [(s.text or "").strip() for s in sense_elem.findall("stagk") if s.text]
    stagr = [(s.text or "").strip() for s in sense_elem.findall("stagr") if s.text]
    if not stagk and not stagr:
        return None
    return (frozenset(stagk) if stagk else frozenset(), frozenset(stagr) if stagr else frozenset())


def sense_applies_to(restrictions, keb, reb):
    """Check if a sense restricted by (stagk, stagr) applies to (keb, reb)."""
    if restrictions is None:
        return True
    stagk_set, stagr_set = restrictions
    if stagk_set and keb not in stagk_set:
        return False
    if stagr_set and reb not in stagr_set:
        return False
    return True


def process_entry(entry):
    """Yield (lemma, reading, translation, pos) rows for one JMdict entry."""
    k_elems = []
    for ke in entry.findall("k_ele"):
        keb = ke.find("keb")
        if keb is not None and keb.text:
            k_elems.append(keb.text.strip())

    r_elems = []
    for re_ in entry.findall("r_ele"):
        reb = re_.find("reb")
        if reb is None or not reb.text:
            continue
        reb_text = reb.text.strip()
        restrictions = frozenset(
            (rr.text or "").strip() for rr in re_.findall("re_restr") if rr.text
        )
        r_elems.append((reb_text, restrictions))

    senses = []
    for sense in entry.findall("sense"):
        glosses = extract_glosses(sense)
        pos_tags = extract_pos(sense)
        restrictions = get_sense_restrictions(sense)
        senses.append((glosses, pos_tags, restrictions))

    if not senses:
        return

    seen_keys = set()

    if not k_elems:
        for reb, _ in r_elems:
            all_glosses, all_pos = collect_senses(senses, restrictions_check=None, keb=None, reb=reb)
            translation = "; ".join(all_glosses)
            pos_str = ", ".join(sorted(all_pos))
            if translation:
                yield (reb, reb, translation, pos_str)
        return

    # Per (kanji, reading) pair
    for reb, re_restr in r_elems:
        applicable = [k for k in k_elems if not re_restr or k in re_restr] or k_elems
        for keb in applicable:
            key = (keb, reb)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            all_glosses, all_pos = collect_senses(senses, restrictions_check=key, keb=keb, reb=reb)
            translation = "; ".join(all_glosses)
            pos_str = ", ".join(sorted(all_pos))
            if translation:
                yield (keb, reb, translation, pos_str)

    # Reading-based lookup: one row per reading (only unrestricted senses)
    for reb, _ in r_elems:
        key = ("__reading__", reb)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        all_glosses, all_pos = collect_senses(senses, restrictions_check=None, keb=None, reb=reb)
        translation = "; ".join(all_glosses)
        pos_str = ", ".join(sorted(all_pos))
        if translation:
            yield (reb, reb, translation, pos_str)


def collect_senses(senses, restrictions_check, keb, reb):
    """Collect glosses and POS from senses that apply to the given (keb, reb).

    If restrictions_check is a (keb, reb) tuple, only senses whose stagk/stagr match are included.
    If restrictions_check is None, only unrestricted senses are included.
    """
    all_glosses = []
    all_pos = set()
    for glosses, pos_tags, restrictions in senses:
        if restrictions_check is not None:
            if not sense_applies_to(restrictions, restrictions_check[0], restrictions_check[1]):
                continue
        else:
            if restrictions is not None:
                continue
        all_glosses.extend(glosses)
        all_pos.update(pos_tags)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for g in all_glosses:
        if g not in seen:
            seen.add(g)
            unique.append(g)
    return unique, all_pos


def main():
    args = parse_args()

    print(f"Parsing {args.input}...", file=sys.stderr)
    tree = ET.parse(args.input)
    root = tree.getroot()

    seen = set()
    total_entries = 0
    total_rows = 0

    with open(args.output, "w", encoding="utf-8") as out:
        for entry in root.findall("entry"):
            total_entries += 1
            for lemma, reading, translation, pos in process_entry(entry):
                key = (lemma, reading)
                if key in seen:
                    continue
                seen.add(key)
                translation = translation.replace("\t", " ").replace("\n", " ")
                pos = pos.replace("\t", " ").replace("\n", " ")
                out.write(f"{lemma}\t{reading}\t{translation}\t{pos}\n")
                total_rows += 1

            if total_entries % 50000 == 0:
                print(f"  {total_entries} entries, {total_rows} rows...", file=sys.stderr)

    print(f"Done: {total_entries} entries → {total_rows} rows → {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
