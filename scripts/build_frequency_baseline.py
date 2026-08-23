#!/usr/bin/env python3
"""Create the fixed, redistributable frequency-baseline assets from wordfreq."""
from pathlib import Path
from wordfreq import top_n_list

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src-tauri" / "resources" / "frequency-baseline"
OUT.mkdir(parents=True, exist_ok=True)

for language in ("en", "zh"):
    words = []
    seen = set()
    for word in top_n_list(language, 10_000):
        word = word.strip().lower() if language == "en" else word.strip()
        if not word or word in seen:
            continue
        seen.add(word)
        words.append(word)
    if len(words) < 10_000:
        raise SystemExit(f"{language}: expected 10,000 unique entries, got {len(words)}")
    (OUT / f"{language}.txt").write_text("\n".join(words[:10_000]) + "\n", encoding="utf-8")
