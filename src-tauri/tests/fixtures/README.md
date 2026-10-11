# English phrase extraction benchmark

`english-phrase-quality-v1.srt` is original dialogue: 180 cues, 3,405 words,
24 minutes 23.75 seconds, across nine scenes. Import this SRT into LexiCue as
English. It is also tested through the application's actual subtitle parser.

The independent `.gold.json` annotates source text, exact character spans,
lexical token positions, canonical headwords, acceptable category alternatives,
contextual senses, register and explicit rejection controls. It is an
agent-authored evaluation fixture, not a claim of independent human linguistic
review. `.manifest.json` records content hashes and the freeze boundary.

Coverage includes the original teaching-video targets, strong collocations,
language-learning terms, inflections, separable phrasal verbs, pronoun slots,
multiple occurrences in one cue, contractions, informal formulas, slang,
regional/offensive usage and literal uses of the same words. Ordinary grammar,
temporary objects and incomplete fragments are negative controls. Single-word
slang remains the word module's responsibility.

Cues 1–120 are development data. Cues 121–180 were originally held out for acceptance;
their 33 required expressions are absent from the editorial expression core.
Do not add holdout answers to the core or use the gold file in production.
After inspecting holdout failures, further tuning requires a fresh unseen
acceptance set; the original holdout remains a regression set.

Validate the fixture and export source rows:

```sh
node scripts/evaluate-english-phrases.mjs --export-native /tmp/lexicue-source.json
```

On macOS, with the pinned E2B weights installed and the native runtime prepared:

```sh
node scripts/benchmark-english-phrases.mjs --output /tmp/lexicue-e2b-quality
```

The runner compiles/signs the test host, copies only the built-in dictionary
read-only into a temporary database, and runs the real production pipeline.
The first run loads the model; the following two keep it loaded. Each run forces
fresh generation, so checkpoint/result caches cannot improve measured quality
or speed. The host never writes user learning records. Report JSON includes the
actual source rows, model ID, elapsed time, predictions and diagnostic counters.
Use `--limit 120 --repeats 1` for development without consuming the holdout.

Score a saved native report:

```sh
node scripts/evaluate-english-phrases.mjs --results /tmp/lexicue-e2b-quality/run-0.json --output /tmp/score.json --assert
```

The default, practical acceptance thresholds (relaxed at the user's request):
expression precision 80%, required occurrence recall 80%, holdout recall 75%,
informal/slang expression recall 80%, source boundaries 98%, category accuracy
85% and emitted register/region/caution precision 85%. A small number of
contextual mistakes is tolerated and reported, including negative-control hits;
these still reduce precision. This is a quality goal, not a claim that an
unannotated incidental expression is necessarily wrong.

Use `--assert --profile strict` to retain the original research-style thresholds
(90% precision, 85% recall, 80% holdout/informal recall, 98% boundaries, 90%
categories, 95% emitted tags, no negative-control hits).
Tag precision evaluates emitted labels; it does not imply complete label recall.
Category alternatives are frozen explicitly rather than changed after scoring.
Performance is measured separately: warm runs should finish within 15 minutes
and within 1.25 times the original pipeline's elapsed time on the same machine.
Results on this fixture do not establish accuracy on arbitrary subtitles.

## Fresh v2 fixture and current status

`english-phrase-quality-v2.srt` contains 60 new cues, 1,123 words and 9:59
of dialogue. Its 40 required expressions are absent from the v1 annotations
and the frozen 108-entry editorial core. Eleven literal/fragment controls,
one allowed incidental camera term and eight filler cues test over-extraction.
Both fixtures now have measured results that were inspected; they are regression
material, not unseen future acceptance sets. Production never reads their gold.

V2 register labels are independently source-verified for only six headwords.
Unverified labels are not assumed neutral and do not enter the tag-precision
denominator for a correctly matched expression. Reports separately expose
`tagVerificationCoverage`, `emittedTags` and `unverifiedTags`; emitted labels
on false predictions still count as unsupported. Exact canonical/spans remain
frozen, so some useful dictionary variants count as misses/false positives.
Do not revise gold after seeing results to make the acceptance check pass.

```sh
node scripts/benchmark-english-phrases.mjs --fixture src-tauri/tests/fixtures/english-phrase-quality-v2 --output /tmp/lexicue-e2b-v2
node scripts/benchmark-english-phrases.mjs --fixture src-tauri/tests/fixtures/english-phrase-quality-v2 --model "$HOME/Library/Application Support/com.lexicue.app/gemma-models/gemma4-e4b-litert-0b2a8980ce15.litertlm" --repeats 1 --output /tmp/lexicue-e4b-v2
```

The pinned filename selects the actual model asset; reports must show its ID.
A quality assertion failure exits 1 even when the native inference completed
successfully. Inspect saved score/native reports to distinguish quality misses
from a runtime failure. E2B's three final v2 runs currently score 68.75%
precision, 80% required recall, 70% informal recall and 100% source boundaries;
this does not meet every practical target. Artifacts and limitations live in
`docs/english-phrase-quality-implementation-2026-10-06.md`.


E4B's one unchanged-pipeline v2 comparison scored 82.93% precision, 82.5%
required recall, 90% informal recall, 100% boundaries/categories and 80%
independently checkable emitted tags. Its cold run took 802.717 seconds versus
E2B's 742.030 seconds; no E4B warm timing or repeat-stability claim is made.
The native test succeeded; the runner's quality assertion exited 1 solely for
80% emitted-tag precision being below the reference 85% threshold. The user
explicitly accepts some inaccuracy, so these are reference goals, not mandatory
release blockers. Installed application now selects E4B, retaining E2B.
Detailed raw results and `model-comparison.json` are saved under
`docs/phrase-quality-results-2026-10-06/`.
