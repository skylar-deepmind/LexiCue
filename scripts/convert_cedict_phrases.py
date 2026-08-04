#!/usr/bin/env python3
"""Derive a compact Chinese phrase/idiom table from the LexiCue CC-CEDICT TSV.

Usage:
    python3 convert_cedict_phrases.py \
        --input src-tauri/resources/cc-cedict.tsv.gz \
        --output src-tauri/resources/cc-cedict-phrases.tsv.gz

The input is the TSV produced by convert_cedict.py (lemma, reading, English
definitions). Only entries that (a) contain at least two Han characters and
(b) are marked as an idiom, proverb or set phrase are kept, so the offline
phrase list stays focused on 成语/惯用语 rather than every compound noun.

Output TSV columns (tab-separated):
    lemma       Phrase text (simplified or traditional variant)
    reading     Pinyin with tone numbers
    translation English definitions (semicolon-separated)
    category    成语 for four-character entries, otherwise 惯用语
"""

import argparse
import gzip
import sys

IDIOM_MARKERS = ("idiom", "proverb", "set phrase")


def count_han(text: str) -> int:
    return sum(1 for c in text if "\u4e00" <= c <= "\u9fff")


def category_for(lemma: str) -> str:
    return "成语" if count_han(lemma) == 4 else "惯用语"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to cc-cedict.tsv.gz")
    parser.add_argument("--output", required=True, help="Path to output TSV.gz file")
    args = parser.parse_args()

    total = 0
    kept = 0
    with gzip.open(args.input, "rt", encoding="utf-8") as src, gzip.open(
        args.output, "wt", encoding="utf-8"
    ) as out:
        for line in src:
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 3:
                continue
            lemma, reading, definitions = fields[0], fields[1], fields[2]
            total += 1
            if count_han(lemma) < 2:
                continue
            lowered = definitions.lower()
            if not any(marker in lowered for marker in IDIOM_MARKERS):
                continue
            out.write(f"{lemma}\t{reading}\t{definitions}\t{category_for(lemma)}\n")
            kept += 1

    print(f"Done: {kept} phrase rows kept from {total} entries -> {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
