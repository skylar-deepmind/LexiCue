#!/usr/bin/env python3
"""Convert CC-CEDICT to a TSV file for LexiCue built-in Chinese dictionary.

Usage:
    python3 convert_cedict.py --input cedict_ts.u8 --output cc-cedict.tsv
    gzip -9 cc-cedict.tsv   # → cc-cedict.tsv.gz

Input is the CC-CEDICT plain-text file. Each data line has the form:

    simplified traditional [pinyin] /definition/definition/

Output TSV columns (tab-separated):
    lemma         Simplified or traditional variant (searchable form)
    reading       Pinyin with tone numbers (e.g. "ni3 hao3")
    translation   English definitions (semicolon-separated)
    part_of_speech  Empty (CC-CEDICT does not carry structured POS tags)

Each entry emits one row per written variant so both simplified and
traditional text can be looked up.
"""

import argparse
import re
import sys

LINE_RE = re.compile(r"^(?P<simp>\S+)\s+(?P<trad>\S+)\s+\[(?P<pinyin>[^\]]+)\]\s+(?P<defs>/.*/)$")


def parse_args():
    parser = argparse.ArgumentParser(description="Convert CC-CEDICT to LexiCue TSV")
    parser.add_argument("--input", required=True, help="Path to CC-CEDICT plain-text file")
    parser.add_argument("--output", required=True, help="Path to output TSV file")
    return parser.parse_args()


def clean(value: str) -> str:
    return value.replace("\t", " ").replace("\n", " ").strip()


def main():
    args = parse_args()

    seen = set()
    total = 0
    skipped = 0

    with open(args.input, "r", encoding="utf-8") as src, open(
        args.output, "w", encoding="utf-8"
    ) as out:
        for line in src:
            if line.startswith("#"):
                continue
            match = LINE_RE.match(line.rstrip("\n"))
            if not match:
                skipped += 1
                continue

            simplified = clean(match.group("simp"))
            traditional = clean(match.group("trad"))
            pinyin = clean(match.group("pinyin"))
            definitions = clean(match.group("defs").strip("/"))
            if not simplified or not definitions:
                skipped += 1
                continue

            variants = {simplified}
            if traditional and traditional != simplified:
                variants.add(traditional)

            for lemma in variants:
                if lemma in seen:
                    continue
                seen.add(lemma)
                out.write(f"{lemma}\t{pinyin}\t{definitions}\n")
                total += 1

    print(f"Done: {total} rows (skipped {skipped} malformed lines) -> {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
