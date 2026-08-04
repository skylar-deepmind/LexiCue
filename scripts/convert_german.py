#!/usr/bin/env python3
"""Generate LexiCue built-in German resources from kaikki.org Wiktionary data.

Downloads (one-time):
  - kaikki.org postprocessed German JSONL.gz (~95MB) from
    https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz
  - German subtitle word frequencies (~17MB) from
    https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_full.txt

Outputs (into --outdir, default ../src-tauri/resources):
  german_wordforms.tsv.gz  surface<TAB>lemma<TAB>pos   (inflected form -> headword)
  german_dict.tsv.gz       lemma<TAB>ipa<TAB>english_glosses<TAB>pos
  GERMAN-LICENSE.txt

Only word forms / lemmas that appear in the frequency list (count >= FREQ_THRESHOLD)
are kept, which keeps the bundled resources small (~3 MB total) while covering
the vast majority of real text.

Usage:
    python3 scripts/convert_german.py [--kaikki PATH] [--freq PATH] [--outdir PATH]
"""

import argparse
import gzip
import io
import json
import re
import sys
import textwrap
import urllib.request

KAIIKI_URL = "https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz"
FREQ_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_full.txt"
)
FREQ_THRESHOLD = 5

VALID_FORM = re.compile(r"^[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*$")
CONTENT_POS = {
    "noun", "verb", "adj", "adv", "pron", "num", "det",
    "prep", "conj", "interj", "particle", "article", "aux", "intj",
}
TEMPLATE_NOISE = {
    "no-table-tags", "inflection-template", "table-tags",
    "strong", "weak", "mixed", "g", "der", "die", "das", "dem", "den", "des",
}
RARE_TAGS = {"obsolete", "archaic", "dialectal", "dated", "rare", "nonstandard"}

LICENSE = textwrap.dedent(
    """\
    LexiCue built-in German word forms and English-gloss dictionary.

    The German word-form and sense data is derived from the kaikki.org
    machine-readable Wiktionary data, extracted by Tatu Ylonen (wiktextract)
    from the English Wiktionary, and is distributed under the CC BY-SA 4.0
    license.

      Source: https://kaikki.org/dictionary/German/
      License: https://creativecommons.org/licenses/by-sa/4.0/

    The word-frequency filter list is derived from OpenSubtitles (2018)
    compiled by hermitdave (FrequencyWords) under an MIT license.

      Source: https://github.com/hermitdave/FrequencyWords

    The resulting TSV files are derived works combining both datasets.
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
    parser = argparse.ArgumentParser(description="Generate LexiCue German resources")
    parser.add_argument("--kaikki", help="path to kaikki German JSONL.gz (downloads if absent)")
    parser.add_argument("--freq", help="path to de_freq.txt (downloads if absent)")
    parser.add_argument("--outdir", default="../src-tauri/resources", help="output directory")
    args = parser.parse_args()

    kaikki = args.kaikki or "kaikki-de.jsonl.gz"
    freq_path = args.freq or "de_freq.txt"
    if not __import__("os").path.exists(kaikki):
        download(KAIIKI_URL, kaikki)
    if not __import__("os").path.exists(freq_path):
        download(FREQ_URL, freq_path)

    freq = load_freq(freq_path)

    # form_lower -> list of (lemma, pos, lemma_freq)
    wordforms: dict = {}
    # lemma_lower -> (glosses, ipa, pos)
    dictionary: dict = {}
    lemma_forms: dict = {}  # lemma_lower -> set of forms

    entries = 0
    for obj in iter_entries(kaikki):
        entries += 1
        if obj.get("lang") != "German":
            continue
        pos = obj.get("pos", "")
        if pos not in CONTENT_POS:
            continue
        word = obj.get("word", "")
        if not VALID_FORM.match(word):
            continue
        word_lower = word.lower()
        lemma_forms.setdefault(word_lower, set()).add(word_lower)

        glosses = []
        for sense in obj.get("senses") or []:
            for gloss in sense.get("glosses", []):
                if gloss and "inflection of" not in gloss:
                    glosses.append(gloss)
        if glosses:
            ipa = next(
                (s.get("ipa", "") for s in (obj.get("sounds") or []) if s.get("ipa")),
                "",
            )
            dictionary.setdefault(word_lower, (glosses[:8], ipa, pos))

        for sense in obj.get("senses") or []:
            form_of = sense.get("form_of")
            if not (form_of and isinstance(form_of, list)):
                continue
            target = form_of[0].get("word", "")
            if target and VALID_FORM.match(target):
                wordforms.setdefault(word_lower, []).append((target, pos, freq.get(target.lower(), 0)))

        for form_obj in obj.get("forms") or []:
            form = form_obj.get("form", "")
            if not VALID_FORM.match(form) or " " in form:
                continue
            if form.lower() in TEMPLATE_NOISE:
                continue
            if any(tag in RARE_TAGS for tag in form_obj.get("tags", [])):
                continue
            wordforms.setdefault(form.lower(), []).append((word, pos, freq.get(word_lower, 0)))
            lemma_forms.setdefault(word_lower, set()).add(form.lower())

        if entries % 100000 == 0:
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
        resolved.setdefault(lemma, (lemma, dictionary.get(lemma, (None, "", ""))[2]))
    print(f"wordform surfaces: {len(resolved)}", file=sys.stderr)

    wf_rows = []
    for form, (lemma, pos) in resolved.items():
        if form in selected or lemma.lower() in selected:
            wf_rows.append((form, lemma, pos))
    wf_rows = sorted(set(wf_rows))
    print(f"wordform rows: {len(wf_rows)}", file=sys.stderr)

    dict_rows = []
    for lemma, (glosses, ipa, pos) in dictionary.items():
        if lemma in selected:
            gloss = "; ".join(glosses).replace("\t", " ").replace("\n", " ")
            dict_rows.append((lemma, ipa, gloss, pos))
    dict_rows = sorted(set(dict_rows))
    print(f"dictionary rows: {len(dict_rows)}", file=sys.stderr)

    wf_path = f"{args.outdir}/german_wordforms.tsv.gz"
    dict_path = f"{args.outdir}/german_dict.tsv.gz"
    with gzip.open(wf_path, "wt", encoding="utf-8", compresslevel=9) as out:
        for form, lemma, pos in wf_rows:
            out.write(f"{form}\t{lemma}\t{pos}\n")
    with gzip.open(dict_path, "wt", encoding="utf-8", compresslevel=9) as out:
        for lemma, ipa, gloss, pos in dict_rows:
            out.write(f"{lemma}\t{ipa}\t{gloss}\t{pos}\n")
    with open(f"{args.outdir}/GERMAN-LICENSE.txt", "w", encoding="utf-8") as out:
        out.write(LICENSE)

    print(f"wrote {wf_path} ({__import__('os').path.getsize(wf_path)} bytes)")
    print(f"wrote {dict_path} ({__import__('os').path.getsize(dict_path)} bytes)")
    print(f"wrote {args.outdir}/GERMAN-LICENSE.txt")


if __name__ == "__main__":
    main()
