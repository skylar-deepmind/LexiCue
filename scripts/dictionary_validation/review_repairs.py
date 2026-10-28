"""Guarded editorial repairs for one fingerprinted, privately supplied source.

Every change carries its original text and evidence. Unknown source versions
must never inherit these corrections implicitly. This is not a claim that all
dictionary translations have received individual linguistic review.
"""

from collections import defaultdict

from longman6 import BLOCKED, classes, text_of


SOURCE_SHA256 = "50ff6b1fc676a9dccbf98678ac4ad6f20a19713f1d92758e13ce80890a9b16a4"
RECORDS = {"kt", "Kt", "arse", "not know your arse from your elbow", "telephoto lens",
           "Brute", "Et tu, Brute?", "stop", "wipe"}


def prepare(tree, key):
    result = {"excluded": set(), "quarantined": [], "changes": [],
              "full_forms": defaultdict(list), "example_scopes": {}}
    if key not in RECORDS:
        return result
    root = tree.getroottree()

    def path(node):
        return root.getpath(node)

    def core(node):
        return not any(classes(a) & BLOCKED for a in [node, *node.iterancestors()])

    def own(scope, name):
        return [n for n in scope.iter() if name in classes(n) and core(n)
                and next((a for a in n.iterancestors() if classes(a) & {"sense", "subsense"}), None) is scope]

    def replace(node, value):
        for child in list(node):
            node.remove(child)
        node.text = value

    def log(rule, scope, before, after, evidence):
        result["changes"].append({"rule": rule, "source_scope_xpath": path(scope),
                                   "before": before, "after": after, "evidence": evidence})

    def exclude(scope, definitions, translations, reason):
        result["excluded"].update(definitions + translations)
        result["quarantined"].append({
            "reason": reason, "source_scope_xpath": path(scope),
            "definition_count": len(definitions), "definitions": [text_of(n) for n in definitions],
            "translations": [text_of(n) for n in translations], "examples": [],
        })

    for scope in tree.iter():
        if not classes(scope) & {"sense", "subsense"} or not core(scope):
            continue
        definitions, translations = own(scope, "def"), own(scope, "defcn")
        en, zh = [text_of(n) for n in definitions], [text_of(n) for n in translations]
        lexical = [text_of(n) for n in own(scope, "lexunit")]
        forms = [text_of(n) for n in own(scope, "fullform")]
        if key in {"kt", "Kt"}:
            expected, correct, form = ("爵士", "节", "knot") if key == "kt" else ("节", "爵士", "knight")
            if en != ["the written abbreviation of"] or zh != [expected] or forms != [form]:
                raise ValueError(f"Reviewed abbreviation guard failed: {key}")
            replace(translations[0], correct)
            log("correct_swapped_abbreviation_translation", scope, {"chinese": expected, "full_form": form},
                {"chinese": correct, "full_form": form}, [
                    "https://dictionary.cambridge.org/us/dictionary/learner-english/knight",
                    "https://dictionary.cambridge.org/dictionary/english/knot?topic=measurements-of-speed",
                    "supplied Longman Study Dictionary 5: knight and knot entries",
                ])
        if "not know your arse from your elbow" in lexical:
            if en != ["used to tell someone to hurry up", "to be stupid and confused about simple things"] or zh != ["快点", "一无所知﹐屁都不懂"]:
                raise ValueError("Reviewed idiom guard failed")
            exclude(scope, definitions[:1], translations[:1], "reviewed_wrong_definition_removed")
            log("remove_foreign_hurry_up_meaning", scope, {"definitions": en, "translations": zh},
                {"definitions": en[1:], "translations": zh[1:]}, [
                    "https://dictionary.cambridge.org/us/dictionary/english/not-know-arse-from-elbow",
                    "supplied Longman 4: arse sense 5 versus sense 6",
                ])
        if key == "telephoto lens" and definitions:
            if len(en) != 2 or en[0] != "a long lens" or not en[1].startswith("that you put on a camera") or zh != ["", "长焦镜头﹐摄远镜头"]:
                raise ValueError("Reviewed split-definition guard failed")
            joined = " ".join(en)
            exclude(scope, definitions[1:], translations[:1], "reviewed_definition_fragment_merged")
            replace(definitions[0], joined)
            log("join_split_relative_clause", scope, {"definitions": en, "translations": zh},
                {"definition": joined, "chinese": zh[1]}, [
                    "supplied Longman 4: telephoto lens, a single continuous definition",
                    "https://dictionary.cambridge.org/dictionary/english/telephoto-lens?topic=photography",
                ])
        if "Et tu, Brute?" in lexical:
            if len(en) != 2 or en[0] != "and you, Brutus?" or "Brutush has betrayed betray him" not in en[1] or zh != ["", ""]:
                raise ValueError("Reviewed quotation guard failed")
            corrected = en[1].replace("Brutush has betrayed betray him", "Brutus has betrayed him")
            exclude(scope, definitions[:1], translations[:1], "reviewed_literal_translation_separated")
            result["full_forms"][scope].append(en[0])
            replace(definitions[1], corrected)
            log("separate_literal_translation_and_fix_transcription", scope, {"definitions": en},
                {"literal_translation": en[0], "definition": corrected, "chinese": None}, [
                    "https://www.folger.edu/blogs/shakespeare-and-beyond/drawing-shakespeare-julius-caesar/",
                    "source contains duplicate betray and mistyped Brutus; no new historical claim added",
                ])

    # Source tags prematurely close a branch before the following pattern group.
    # These exact cases were checked in the source, not inferred for all pages.
    for scope in tree.iter():
        if "sense" not in classes(scope) or not core(scope):
            continue
        children = [n for n in scope if "subsense" in classes(n)]
        if key == "stop":
            target = next((n for n in children if [text_of(d) for d in own(n, "def")] == ["to not walk, move, or travel anymore, or to make someone or something do this"]), None)
            expected_count = 7
        elif key == "wipe":
            target = next((n for n in children if [text_of(d) for d in own(n, "def")] == ["to clean something by rubbing it against a surface"]), None)
            expected_count = 1
        else:
            continue
        if target is None:
            continue
        candidates = [n for n in own(scope, "example") if n.getparent() is not scope]
        if len(candidates) != expected_count:
            raise ValueError(f"Reviewed example-boundary guard failed: {key}")
        for node in candidates:
            result["example_scopes"][node] = target
            log("restore_reviewed_trailing_pattern_example", scope,
                {"example_xpath": path(node), "example": text_of(node)},
                {"definition_xpath": path(own(target, "def")[0]), "repaired_scope_xpath": path(target)},
                [f"supplied source {key}: preceding branch definition and matching explicit usage pattern"])
    return result
