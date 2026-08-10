#!/usr/bin/env python3
"""Generate the LexiCue built-in English word-form resource from kaikki.org data.

Downloads (one-time):
  - kaikki.org postprocessed English JSONL.gz (~500MB) from
    https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
  - English word frequencies (~20MB) from
    https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt

Outputs (into --outdir, default ../src-tauri/resources):
  english_wordforms.tsv.gz  surface<TAB>lemma<TAB>pos   (inflected form -> headword)
  ENGLISH-LICENSE.txt

Only word forms / lemmas that appear in the frequency list (count >= FREQ_THRESHOLD)
are kept, which keeps the bundled resource small while covering the vast
majority of real text.

Usage:
    python3 scripts/convert_english.py [--kaikki PATH] [--freq PATH] [--outdir PATH]
"""

import argparse
import gzip
import io
import json
import os
import re
import sys
import textwrap
import urllib.request

KAIIKI_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"
FREQ_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt"
)
FREQ_THRESHOLD = 5

VALID_FORM = re.compile(r"^[a-z]+(?:-[a-z]+)*$")
CONTENT_POS = {
    "noun", "verb", "adj", "adv", "pron", "num", "det",
    "prep", "conj", "interj", "particle", "article", "aux", "intj",
}
SKIP_FORM_TAGS = {
    "alternative", "misspelling", "misspelled", "obsolete", "archaic",
    "dialectal", "dated", "rare", "nonstandard", "poetic", "informal",
    "colloquial", "eye-dialect", "nonstandard", "contraction",
}

LICENSE = textwrap.dedent(
    """\
    LexiCue built-in English word forms.

    The English word-form data is derived from the kaikki.org machine-readable
    Wiktionary data, extracted by Tatu Ylonen (wiktextract) from the English
    Wiktionary, and is distributed under the CC BY-SA 4.0 license.

      Source: https://kaikki.org/dictionary/English/
      License: https://creativecommons.org/licenses/by-sa/4.0/

    The word-frequency filter list is derived from OpenSubtitles (2018)
    compiled by hermitdave (FrequencyWords) under an MIT license.

      Source: https://github.com/hermitdave/FrequencyWords

    The resulting TSV file is a derived work combining both datasets.
    """
)


def download(url: str, dest: str) -> None:
    print(f"downloading {url} -> {dest}", file=sys.stderr)
    urllib.request.urlretrieve(url, dest)


def load_freq(path: str) -> dict:
    freq: dict = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split(" ")
            if len(parts) != 2:
                continue
            try:
                count = int(parts[1])
            except ValueError:
                continue
            freq[parts[0].lower()] = count
    print(f"loaded {len(freq)} frequency words", file=sys.stderr)
    return freq


def iter_entries(path: str):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate LexiCue English word forms")
    parser.add_argument("--kaikki", help="path to kaikki English JSONL.gz (downloads if absent)")
    parser.add_argument("--freq", help="path to en_freq.txt (downloads if absent)")
    parser.add_argument("--outdir", default="../src-tauri/resources", help="output directory")
    args = parser.parse_args()

    kaikki = args.kaikki or "kaikki-en.jsonl.gz"
    freq_path = args.freq or "en_freq.txt"
    if not os.path.exists(kaikki):
        download(KAIIKI_URL, kaikki)
    if not os.path.exists(freq_path):
        download(FREQ_URL, freq_path)

    freq = load_freq(freq_path)

    # form_lower -> list of (lemma, pos, lemma_freq)
    wordforms: dict = {}
    lemma_forms: dict = {}  # lemma_lower -> set of forms

    entries = 0
    for obj in iter_entries(kaikki):
        entries += 1
        if obj.get("lang") != "English":
            continue
        pos = obj.get("pos", "")
        if pos not in CONTENT_POS:
            continue
        word = obj.get("word", "")
        if not VALID_FORM.match(word.lower()):
            continue
        word_lower = word.lower()
        lemma_forms.setdefault(word_lower, set()).add(word_lower)

        has_form_of = False
        for sense in obj.get("senses") or []:
            form_of = sense.get("form_of")
            if not (form_of and isinstance(form_of, list)):
                continue
            has_form_of = True
            target = form_of[0].get("word", "")
            if target and VALID_FORM.match(target.lower()):
                wordforms.setdefault(word_lower, []).append(
                    (target.lower(), pos, freq.get(target.lower(), 0))
                )

        # A genuine headword maps to itself. Inflection-of pages (e.g. "went")
        # must not self-map, otherwise the dialectal target would win.
        if not has_form_of:
            wordforms.setdefault(word_lower, []).append(
                (word_lower, pos, freq.get(word_lower, 0))
            )

        for form_obj in obj.get("forms") or []:
            form = form_obj.get("form", "")
            form_lower = form.lower()
            if not VALID_FORM.match(form_lower) or " " in form:
                continue
            tags = set(form_obj.get("tags", []))
            if tags & SKIP_FORM_TAGS:
                continue
            wordforms.setdefault(form_lower, []).append(
                (word_lower, pos, freq.get(word_lower, 0))
            )
            lemma_forms.setdefault(word_lower, set()).add(form_lower)

        if entries % 200000 == 0:
            print(f"  processed {entries} entries", file=sys.stderr)

    print(f"parsed {entries} entries", file=sys.stderr)

    # Select lemmas whose surface or any inflected form is frequent enough.
    selected = {
        lemma for lemma, forms in lemma_forms.items()
        if max((freq.get(f, 0) for f in forms), default=0) >= FREQ_THRESHOLD
    }
    print(f"selected {len(selected)} lemmas", file=sys.stderr)

    # Resolve each surface to its best lemma (highest lemma frequency wins).
    resolved = {}
    for form, candidates in wordforms.items():
        if not candidates:
            continue
        best = max(candidates, key=lambda c: c[2])
        resolved[form] = (best[0], best[1])
    for lemma in selected:
        resolved.setdefault(lemma, (lemma, ""))
    print(f"wordform surfaces: {len(resolved)}", file=sys.stderr)

    wf_rows = []
    for form, (lemma, pos) in resolved.items():
        if form in selected or lemma in selected:
            wf_rows.append((form, lemma, pos))
    wf_rows = sorted(set(wf_rows))
    print(f"wordform rows: {len(wf_rows)}", file=sys.stderr)

    wf_path = f"{args.outdir}/english_wordforms.tsv.gz"
    with gzip.open(wf_path, "wt", encoding="utf-8", compresslevel=9) as out:
        for form, lemma, pos in wf_rows:
            out.write(f"{form}\t{lemma}\t{pos}\n")
    with open(f"{args.outdir}/ENGLISH-LICENSE.txt", "w", encoding="utf-8") as out:
        out.write(LICENSE)

    print(f"wrote {wf_path} ({os.path.getsize(wf_path)} bytes)")
    print(f"wrote {args.outdir}/ENGLISH-LICENSE.txt")


if __name__ == "__main__":
    main()
