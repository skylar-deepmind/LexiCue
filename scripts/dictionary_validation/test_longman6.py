"""Synthetic regressions for ownership and bilingual alignment, not source copies."""

import sqlite3
import unittest

from longman6 import SCHEMA, parse_record, store_record


def example(english, chinese=None):
    translation = f"<expcn>{chinese}</expcn>" if chinese is not None else ""
    return f'<span class="example"><expen>{english}</expen>{translation}</span>'


def word(body, headword="sample", pos="noun", popup=""):
    return (
        '<span class="entry"><span class="entryhead">'
        f'<span class="hwd">{headword}</span><span class="pos">{pos}</span>'
        f'<span class="buttons"><div class="at-link">{popup}</div></span>'
        f'</span>{body}</span>'
    )


def sense(english, chinese=None, samples="", prefix="", suffix=""):
    translation = f'<span class="defcn">{chinese}</span>' if chinese is not None else ""
    return (
        f'<span class="sense">{prefix}<span class="def">{english}</span>'
        f'{translation}{samples}{suffix}</span>'
    )


class AlignmentTests(unittest.TestCase):
    def test_foreign_popup_definition_and_examples_cannot_become_current_meanings(self):
        popup = word(sense("Foreign definition", "旁支", example("Foreign example.", "旁支例句。")), "other")
        parsed = parse_record(word(sense("Current definition", "本义", example("Current example.", "本义例句。")), popup=popup), "sample")
        self.assertEqual([s["definition_en"] for s in parsed["senses"]], ["Current definition"])
        self.assertEqual(parsed["senses"][0]["examples"][0]["english"], "Current example.")
        self.assertEqual(parsed["source_counts"]["excluded_def"], 1)
        self.assertEqual(parsed["source_counts"]["excluded_example"], 1)

    def test_missing_translation_does_not_shift_the_following_translation(self):
        parsed = parse_record(word(
            sense("First meaning", samples=example("First example."))
            + sense("Second meaning", "第二义", example("Second example.", "第二例。"))
        ), "sample")
        first, second = parsed["senses"]
        self.assertIsNone(first["definition_zh"])
        self.assertIn("missing_definition_chinese", first["issues"])
        self.assertEqual(second["definition_zh"], "第二义")
        self.assertIsNone(first["examples"][0]["chinese"])
        self.assertEqual(second["examples"][0]["chinese"], "第二例。")

    def test_subsenses_own_their_examples_and_chinese(self):
        body = (
            '<span class="sense"><span class="sensenum">1</span>'
            '<span class="subsense"><span class="sensenum">a)</span>'
            '<span class="def">First branch</span><span class="defcn">甲义</span>'
            + example("A branch.", "甲例。") + '</span>'
            '<span class="subsense"><span class="sensenum">b)</span>'
            '<span class="def">Second branch</span><span class="defcn">乙义</span>'
            + example("B branch.", "乙例。") + '</span></span>'
        )
        parsed = parse_record(word(body), "sample")
        self.assertEqual([s["definition_zh"] for s in parsed["senses"]], ["甲义", "乙义"])
        self.assertEqual([s["examples"][0]["english"] for s in parsed["senses"]], ["A branch.", "B branch."])
        self.assertEqual(parsed["senses"][1]["source_sense_numbers"], ["1", "b)"])

    def test_usage_note_example_stays_out_of_the_expression_examples(self):
        note = (
            '<span class="f2nbox"><span class="heading">Register</span>'
            '<explen>A formal alternative is available.</explen><explcn>另有正式表达。</explcn>'
            + example("Use the alternative here.", "此处使用替代表达。") + '</span>'
        )
        body = '<span class="phrvbentry"><span class="entryhead"><span class="phrvbhwd">hold on</span><span class="pos">phrasal verb</span></span>'
        body += sense("Wait briefly", "稍等", example("Hold on a moment.", "稍等片刻。"), suffix=note) + '</span>'
        parsed = parse_record(body, "hold on")
        self.assertEqual([e["english"] for e in parsed["senses"][0]["examples"]], ["Hold on a moment."])
        self.assertEqual(parsed["notes"][0]["examples"][0]["english"], "Use the alternative here.")
        self.assertEqual(parsed["senses"][0]["usage_note_ids"], [parsed["notes"][0]["id"]])

    def test_standalone_expression_preserves_source_pattern_without_inventing_idiom_type(self):
        body = sense("Start a conversation", "开始交谈", example("We started chatting.", "我们聊了起来。"), prefix='<span class="lexunit">open the conversation</span>')
        parsed = parse_record(body, "open the conversation")
        record = parsed["senses"][0]
        self.assertEqual(record["unit"]["kind"], "expression")
        self.assertEqual(record["unit"]["headword"], "open the conversation")
        self.assertEqual(record["expression_pattern"], "open the conversation")

    def test_separable_phrasal_pattern_and_object_slot_are_preserved(self):
        body = '<span class="phrvbentry"><span class="entryhead"><span class="phrvbhwd">pick up<span class="object"> something</span></span><span class="pos">phrasal verb</span></span>'
        body += sense("Lift something", "拿起", example("Pick the parcel up.", "拿起包裹。"), prefix='<span class="lexunit">pick something ↔ up</span>') + '</span>'
        parsed = parse_record(body, "pick up something")
        record = parsed["senses"][0]
        self.assertEqual(record["unit"]["headword"], "pick up")
        self.assertEqual(record["expression_pattern"], "pick something ↔ up")

    def test_multiple_definitions_in_one_scope_are_quarantined_instead_of_zipped(self):
        body = '<span class="sense"><span class="def">One</span><span class="def">Two</span><span class="defcn">Only one Chinese node</span>' + example("Uncertain owner.", "归属不明。") + '</span>'
        parsed = parse_record(word(body), "sample")
        self.assertEqual(parsed["senses"], [])
        self.assertEqual(parsed["quarantined"][0]["definition_count"], 2)
        self.assertEqual(parsed["quarantined"][0]["reason"], "multiple_definitions_in_scope")

    def test_unowned_parent_example_is_not_assigned_to_a_random_subsense(self):
        body = '<span class="sense"><span class="subsense"><span class="def">Branch meaning</span><span class="defcn">分支义</span></span>' + example("General parent example.", "父层例句。") + '</span>'
        parsed = parse_record(word(body), "sample")
        self.assertEqual(parsed["senses"][0]["examples"], [])
        self.assertEqual(parsed["quarantined"][0]["reason"], "examples_without_owned_definition")

    def test_inline_highlights_do_not_insert_spaces_inside_a_word(self):
        parsed = parse_record(word(sense("Move on foot", "步行", example('She walk<span>ed</span> home.', "她走回家。"))), "walk")
        self.assertEqual(parsed["senses"][0]["examples"][0]["english"], "She walked home.")

    def test_derived_examples_keep_their_own_headword_without_a_fabricated_definition(self):
        derivative = '<span class="runon"><span class="deriv">—clearly</span><span class="pos">adverb</span>' + example("Speak clearly.", "说清楚。") + '</span>'
        parsed = parse_record(word(sense("Easy to understand", "清楚的") + derivative, "clear", "adjective"), "clear")
        self.assertEqual(parsed["senses"][0]["examples"], [])
        self.assertEqual(parsed["derivatives"][0]["headword"], "clearly")
        self.assertEqual(parsed["derivatives"][0]["parent_headword"], "clear")
        self.assertEqual(parsed["derivatives"][0]["definition_status"], "not_independently_defined_in_source")
        self.assertEqual(parsed["derivatives"][0]["examples"][0]["english"], "Speak clearly.")
        self.assertEqual(parsed["quarantined"], [])

    def test_trailing_subsense_examples_require_explicit_colon_evidence(self):
        body = '<span class="sense"><span class="subsense"><span class="sensenum">a)</span><span class="def">First branch</span><span class="defcn">甲义</span></span><span class="subsense"><span class="sensenum">b)</span><span class="def">Second branch</span><span class="defcn">乙义</span><span class="neutral">:</span></span>' + example("The second branch.", "乙例。") + '</span>'
        parsed = parse_record(word(body), "sample")
        self.assertEqual(parsed["senses"][0]["examples"], [])
        self.assertEqual(parsed["senses"][1]["examples"][0]["english"], "The second branch.")
        self.assertEqual(parsed["layout_repairs"][0]["rule"], "trailing_examples_after_closed_subsense_colon")
        self.assertEqual(parsed["quarantined"], [])

    def test_headerless_aggregate_definitions_never_become_a_fake_word(self):
        parsed = parse_record(sense("A definition from a different word", "旁支释义"), "grammar index")
        self.assertEqual(parsed["senses"], [])
        self.assertEqual(parsed["quarantined"][0]["reason"], "missing_unit_header")

    def test_abbreviation_full_form_remains_with_its_definition(self):
        body = sense("the written abbreviation of", suffix='<span class="fullform"> sample expansion</span>')
        parsed = parse_record(word(body, "SE"), "SE")
        self.assertEqual(parsed["senses"][0]["definition_en"], "the written abbreviation of")
        self.assertEqual(parsed["senses"][0]["full_forms"], ["sample expansion"])
        self.assertNotIn("incomplete_abbreviation_reference", parsed["senses"][0]["issues"])

    def test_abbreviation_without_full_form_is_not_eligible(self):
        parsed = parse_record(word(sense("the written abbreviation of", "缩写"), "SE"), "SE")
        self.assertFalse(parsed["senses"][0]["eligible"])
        self.assertIn("incomplete_abbreviation_reference", parsed["senses"][0]["issues"])

    def test_cross_references_keep_relation_and_target_without_becoming_a_definition(self):
        ref = '<span class="crossref"> →<a href="entry://other#sense2">other</a></span>'
        body = sense("A meaning", "释义", suffix=ref)
        parsed = parse_record(word(body), "sample")
        relation = parsed["senses"][0]["relations"][0]
        self.assertEqual(relation["kind"], "crossref")
        self.assertEqual(relation["targets"], [{"target": "other#sense2", "label": "other"}])
        self.assertEqual(parsed["senses"][0]["definition_en"], "A meaning")

    def test_case_sensitive_headwords_remain_distinct_despite_same_definition(self):
        lower = parse_record(word(sense("A written symbol", "符号"), "se"), "se", 1)
        upper = parse_record(word(sense("A written symbol", "符号"), "SE"), "SE", 2)
        connection = sqlite3.connect(":memory:")
        connection.executescript(SCHEMA)
        store_record(connection, lower); store_record(connection, upper)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM units").fetchone()[0], 2)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM senses").fetchone()[0], 2)
        self.assertEqual(connection.execute("SELECT COUNT(DISTINCT lookup_key) FROM units").fetchone()[0], 1)

    def test_collocation_gloss_and_its_example_remain_with_the_pattern(self):
        construction = ('<span class="colloexa"><span class="collo">sample a pattern</span>'
                        '<span class="gloss">(=use this form)</span><span class="collocn">使用此形式</span>'
                        + example("Sample a pattern here.", "在此使用此形式。") + '</span>')
        parsed = parse_record(word(sense("A general meaning", "本义", construction)), "sample")
        item = parsed["constructions"][0]
        self.assertEqual(item["pattern"], "sample a pattern")
        self.assertEqual(item["gloss_en"], ["(=use this form)"])
        self.assertEqual(item["explanation_zh"], ["使用此形式"])
        self.assertEqual(item["examples"][0]["chinese"], "在此使用此形式。")
        self.assertEqual(parsed["senses"][0]["construction_ids"], [item["id"]])

    def test_note_only_collocation_does_not_borrow_the_parent_definition(self):
        note = ('<span class="collobox"><span class="collocate"><span class="colloc collo">a special pattern</span>'
                '<span class="collgloss">(=a special use)</span>'
                + example("A special pattern is used.") + '</span></span>')
        parsed = parse_record(word(sense("A general meaning", "本义") + note), "sample")
        self.assertEqual(parsed["senses"][0]["examples"], [])
        self.assertEqual(parsed["senses"][0]["construction_ids"], [])
        self.assertEqual(parsed["constructions"][0]["context_kind"], "usage_note")
        self.assertEqual(parsed["constructions"][0]["examples"][0]["english"], "A special pattern is used.")
        self.assertIsNone(parsed["constructions"][0]["examples"][0]["chinese"])

    def test_parent_and_extracted_expression_deduplicate_without_losing_provenance(self):
        body = sense("Arrive as scheduled", "准时到达", example("We arrived on time.", "我们准时到达。"), prefix='<span class="lexunit">on time</span>')
        parent = parse_record(word(body, "time"), "time", 1)
        extracted = parse_record(body, "on time", 2)
        connection = sqlite3.connect(":memory:")
        connection.executescript(SCHEMA)
        store_record(connection, parent); store_record(connection, extracted)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM senses").fetchone()[0], 1)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM examples").fetchone()[0], 1)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM occurrences").fetchone()[0], 2)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM example_occurrences").fetchone()[0], 2)
        self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_reviewed_abbreviation_correction_preserves_before_and_after(self):
        body = sense("the written abbreviation of", "爵士", suffix='<span class="fullform">knot</span>')
        parsed = parse_record(word(body, "kt"), "kt", reviewed=True)
        self.assertEqual(parsed["senses"][0]["definition_zh"], "节")
        self.assertTrue(parsed["senses"][0]["eligible"])
        change = parsed["reviewed_changes"][0]
        self.assertEqual(change["before"]["chinese"], "爵士")
        self.assertEqual(change["after"]["chinese"], "节")
        connection = sqlite3.connect(":memory:")
        connection.executescript(SCHEMA)
        store_record(connection, parsed)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM correction_log").fetchone()[0], 1)

    def test_reviewed_repair_refuses_unexpected_source_content(self):
        body = sense("the written abbreviation of", "不一样", suffix='<span class="fullform">knot</span>')
        with self.assertRaisesRegex(ValueError, "guard failed"):
            parse_record(word(body, "kt"), "kt", reviewed=True)

    def test_reviewed_wrong_idiom_meaning_removed_without_losing_evidence(self):
        body = ('<span class="sense"><span class="lexunit">not know your arse from your elbow</span>'
                '<span class="def">used to tell someone to hurry up</span><span class="defcn">快点</span>'
                '<span class="def">to be stupid and confused about simple things</span><span class="defcn">一无所知﹐屁都不懂</span></span>')
        parsed = parse_record(body, "not know your arse from your elbow", reviewed=True)
        self.assertEqual(len(parsed["senses"]), 1)
        self.assertEqual(parsed["senses"][0]["definition_zh"], "一无所知﹐屁都不懂")
        self.assertEqual(parsed["quarantined"][0]["definitions"], ["used to tell someone to hurry up"])
        self.assertEqual(parsed["source_counts"]["core_def"], 2)

    def test_reviewed_split_definition_preserves_its_complete_relative_clause(self):
        body = ('<span class="sense"><span class="def">a long lens</span><span class="defcn"></span>'
                '<span class="def">that you put on a camera to view a distant object</span>'
                '<span class="defcn">长焦镜头﹐摄远镜头</span></span>')
        parsed = parse_record(word(body, "telephoto lens"), "telephoto lens", reviewed=True)
        self.assertEqual(len(parsed["senses"]), 1)
        self.assertEqual(parsed["senses"][0]["definition_en"], "a long lens that you put on a camera to view a distant object")
        self.assertEqual(parsed["senses"][0]["definition_zh"], "长焦镜头﹐摄远镜头")
        self.assertEqual(parsed["quarantined"][0]["definition_count"], 1)


if __name__ == "__main__":
    unittest.main()
