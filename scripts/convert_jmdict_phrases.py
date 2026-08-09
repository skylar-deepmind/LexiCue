#!/usr/bin/env python3
"""Derive a compact Japanese idiom table from the jmdict-simplified JSON.

Usage:
    python3 convert_jmdict_phrases.py \
        --input scripts/cache/jmdict-eng-<version>.json.tgz \
        --output src-tauri/resources/jmdict-phrases.tsv.gz

The input is the JSON release of JMdict from
https://github.com/scriptin/jmdict-simplified (which mirrors the official
JMdict_e.xml). Only entries whose sense carries the "id" (idiomatic
expression) marker are kept, so the offline phrase list stays focused on
慣用句 rather than every multi-word expression. Single-character forms are
dropped (e.g. 嚏) because they are isolated words, not phrases.

Output TSV columns (tab-separated):
    text        Phrase text (first kanji form, or reading when kana-only)
    reading     Kana reading
    translation English glosses (semicolon-separated)
    category    Always 慣用句
"""

import argparse
import gzip
import io
import json
import sys
import tarfile


def load_words(path: str):
    if path.endswith((".tgz", ".tar.gz")):
        with tarfile.open(path, "r:gz") as tar:
            member = tar.getmembers()[0]
            raw = tar.extractfile(member).read()
            return json.loads(raw)["words"]
    with open(path, "r", encoding="utf-8") as src:
        return json.load(src)["words"]


def primary_form(word) -> str:
    kanji = [k["text"] for k in word.get("kanji", []) if k.get("text")]
    if kanji:
        return kanji[0]
    kana = [k["text"] for k in word.get("kana", []) if k.get("text")]
    return kana[0] if kana else ""


def primary_reading(word) -> str:
    kana = [k["text"] for k in word.get("kana", []) if k.get("text")]
    return kana[0] if kana else ""


def idiom_glosses(word):
    for sense in word.get("sense", []):
        if "id" in sense.get("misc", []):
            glosses = [
                g["text"].strip()
                for g in sense.get("gloss", [])
                if g.get("text") and g.get("text").strip()
            ]
            if glosses:
                return glosses
    # Fall back to any gloss if the idiom-tagged sense had none.
    for sense in word.get("sense", []):
        glosses = [
            g["text"].strip()
            for g in sense.get("gloss", [])
            if g.get("text") and g.get("text").strip()
        ]
        if glosses:
            return glosses
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to jmdict-simplified JSON or .tgz")
    parser.add_argument("--output", required=True, help="Path to output TSV.gz file")
    args = parser.parse_args()

    words = load_words(args.input)
    kept = 0
    buffer = io.StringIO()
    for word in words:
        if not any("id" in sense.get("misc", []) for sense in word.get("sense", [])):
            continue
        text = primary_form(word)
        if len(text) < 2:
            continue
        reading = primary_reading(word)
        glosses = idiom_glosses(word)
        if not glosses:
            continue
        translation = "; ".join(glosses).replace("\t", " ").replace("\n", " ")
        buffer.write(f"{text}\t{reading}\t{translation}\t慣用句\n")
        kept += 1

    with gzip.open(args.output, "wt", encoding="utf-8") as out:
        out.write(buffer.getvalue())

    print(f"Done: {kept} idiom rows -> {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
