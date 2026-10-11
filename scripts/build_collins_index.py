#!/usr/bin/env python3
"""Build a private, local-only COBUILD V3 index from the owner's MOBI/HTML.

The generated SQLite database contains copyrighted dictionary text. Keep it in
the app data directory; do not commit or distribute it with LexiCue.
"""

import argparse
from html.parser import HTMLParser
import hashlib
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import os
import signal
import time


PROVIDER = "Collins COBUILD V3"
HEADING = re.compile(r"<h2\b[^>]*>(.*?)</h2>", re.I | re.S)
IMAGE = re.compile(r"<img\b[^>]*\/?>", re.I)
GRAMMAR = re.compile(r'<font\b[^>]*class="calibre_14"[^>]*>(.*?)</font>', re.I | re.S)
EXAMPLE = re.compile(r'<font\b[^>]*class="calibre_21"[^>]*>(.*?)</font>', re.I | re.S)
DFN = re.compile(r"<dfn\b[^>]*>(.*?)</dfn>", re.I | re.S)
BOLD = re.compile(r'<span\b[^>]*class="bold"[^>]*>(.*?)</span>', re.I | re.S)
HOMOGRAPH = re.compile(r"\s+[1-9]$")


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(fragment):
    parser = PlainText()
    parser.feed(fragment)
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def key(text):
    return re.sub(r"\s+", " ", text.strip()).casefold()


def sense_rows(html):
    blocks = re.split(r"(?=<h2\b)", html, flags=re.I)
    for block in blocks:
        heading = HEADING.match(block)
        if not heading:
            continue
        headword = plain(heading.group(1))
        if not headword:
            continue
        lemma = HOMOGRAPH.sub("", headword)
        chunks = IMAGE.split(block[heading.end():])
        current = None
        for chunk in chunks:
            marker = GRAMMAR.search(chunk)
            if marker:
                if current:
                    yield current
                grammar = plain(marker.group(1)).strip("[]")
                # A break normally separates the grammar tag from its full-sentence
                # definition. A short editorial label may come before another break.
                parts = re.split(r"<br\s*/?>", chunk[marker.end():], flags=re.I)
                first = next((i for i, part in enumerate(parts) if plain(part)), None)
                if first is None:
                    current = None
                    continue
                tail = parts[first]
                if len(plain(tail)) < 20 and first + 1 < len(parts):
                    tail += " " + parts[first + 1]
                definition = plain(tail)
                if not definition:
                    current = None
                    continue
                labels = [plain(value) for value in DFN.findall(tail)]
                phrases = list(dict.fromkeys(label for label in labels if len(label.split()) >= 2))
                if grammar.startswith("PHR") and not phrases:
                    # Some editorial phrase senses use bold instead of <dfn>,
                    # e.g. "along with" under "along".
                    for fragment in BOLD.findall(tail):
                        value = plain(fragment)
                        if 2 <= len(value.split()) <= 8:
                            phrases = [value]
                            break
                if len(lemma.split()) >= 2:
                    phrases.insert(0, lemma)
                is_phrase = grammar.startswith("PHR") or bool(phrases)
                current = (headword, grammar, definition, [], list(dict.fromkeys(phrases)), is_phrase)
            elif current:
                examples = [plain(value) for value in EXAMPLE.findall(chunk)]
                current[3].extend(value for value in examples if value)
        if current:
            yield current


def html_from_mobi(path):
    with tempfile.TemporaryDirectory(prefix="lexicue-collins-") as folder:
        debug = Path(folder) / "pipeline"
        page = debug / "input" / "index.html"
        # The output plugin can spend a long time repackaging this large
        # dictionary. Its input-stage HTML is already complete and is all
        # the parser needs, so stop conversion once that snapshot is ready.
        process = subprocess.Popen(
            ["ebook-convert", str(path), str(Path(folder) / "unused.epub"),
             "--debug-pipeline", str(debug)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline:
                if page.exists() and page.stat().st_size > 1000:
                    with page.open("rb") as source:
                        source.seek(max(0, page.stat().st_size - 32))
                        if b"</html>" in source.read().lower():
                            return page.read_text(encoding="utf-8")
                if process.poll() is not None:
                    raise RuntimeError("Calibre exited before creating input-stage HTML")
                time.sleep(0.5)
            raise TimeoutError("Calibre did not extract the MOBI within ten minutes")
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()


def build(html, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="collins-index-", suffix=".sqlite", dir=output.parent, delete=False) as tmp:
        temporary = Path(tmp.name)
    try:
        conn = sqlite3.connect(temporary)
        conn.executescript("""
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE word_senses (
                id INTEGER PRIMARY KEY, lookup_key TEXT NOT NULL, headword TEXT NOT NULL,
                grammar TEXT NOT NULL, definition TEXT NOT NULL, example TEXT
            );
            CREATE TABLE phrase_senses (
                id INTEGER PRIMARY KEY, lookup_key TEXT NOT NULL, phrase TEXT NOT NULL,
                headword TEXT NOT NULL, grammar TEXT NOT NULL, definition TEXT NOT NULL, example TEXT
            );
            CREATE INDEX word_lookup ON word_senses(lookup_key);
            CREATE INDEX phrase_lookup ON phrase_senses(lookup_key);
        """)
        conn.executemany("INSERT INTO metadata VALUES (?,?)", [
            ("provider", PROVIDER), ("version", "3"),
            ("html_sha256", hashlib.sha256(html.encode("utf-8")).hexdigest()),
        ])
        words = phrases = 0
        for headword, grammar, definition, examples, names, is_phrase in sense_rows(html):
            example = examples[0] if examples else None
            if not is_phrase:
                lemma = HOMOGRAPH.sub("", headword)
                conn.execute("INSERT INTO word_senses(lookup_key,headword,grammar,definition,example) VALUES (?,?,?,?,?)",
                             (key(lemma), headword, grammar, definition, example))
                words += 1
            for phrase in names:
                conn.execute("INSERT INTO phrase_senses(lookup_key,phrase,headword,grammar,definition,example) VALUES (?,?,?,?,?,?)",
                             (key(phrase), phrase, headword, grammar, definition, example))
                phrases += 1
        conn.commit()
        conn.close()
        temporary.replace(output)
        return words, phrases
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--mobi", type=Path)
    source.add_argument("--html", type=Path, help="Already converted Calibre index.html")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.html:
        html = args.html.read_text(encoding="utf-8")
        counts = build(html, args.output)
    else:
        counts = build(html_from_mobi(args.mobi), args.output)
    print(f"{PROVIDER}: {counts[0]} word senses, {counts[1]} phrase senses -> {args.output}")


if __name__ == "__main__":
    main()
