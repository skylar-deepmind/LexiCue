"""Regressions for reference parsing, availability, and safe lookup."""

import sqlite3
import unittest

from compare_references import study_senses
from finalize_review import lexical_flags, lookup, resolve_source_redirects, without_article


class ReviewTests(unittest.TestCase):
    def test_study_translation_is_read_from_the_same_definition(self):
        markup = ('<entry><hwd><base>sample<inflx>samples</inflx></hwd>'
                  '<sense><def>A first meaning<span class="ch_def">第一义</span></def></sense>'
                  '<sense><def>A second meaning<span class="ch_def">第二义</span></def></sense></entry>')
        self.assertEqual(list(study_senses(markup)), [
            ("sample", "word", "A first meaning", "第一义", []),
            ("sample", "word", "A second meaning", "第二义", []),
        ])

    def test_study_definition_without_translation_is_not_a_translation_source(self):
        markup = '<entry><hwd>sample</hwd><sense><def>A meaning without Chinese</def></sense></entry>'
        self.assertEqual(list(study_senses(markup)), [])

    def test_missing_translation_and_dated_reference_are_visible(self):
        flags = lexical_flags("(1900–1980) a writer", None)
        self.assertIn("chinese_missing", flags)
        self.assertIn("dated_encyclopedic_reference", flags)
        self.assertNotIn("dated_encyclopedic_reference", lexical_flags("a type of book", "一种书"))

    def test_abbreviation_with_expansion_is_not_treated_as_truncated(self):
        self.assertIn("reference_complement_missing", lexical_flags("the written abbreviation of", "缩写"))
        self.assertNotIn("reference_complement_missing", lexical_flags("the written abbreviation of", "缩写", ["sample"]))

    def test_lookup_prefers_exact_case_before_folded_candidates(self):
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE reviewed_lookup(query_text,lookup_key,unit_id)")
        db.executemany("INSERT INTO reviewed_lookup VALUES(?,?,?)", [
            ("us", "us", "pronoun"), ("US", "us", "country"),
            ("piece of cake", "piece of cake", "source-expression"),
        ])
        self.assertEqual(lookup(db, "us"), ["pronoun"])
        self.assertEqual(lookup(db, "US"), ["country"])
        self.assertEqual(lookup(db, "piece of cake"), ["source-expression"])
        self.assertEqual(lookup(db, "an unknown expression"), [])

    def test_dictionary_articles_can_move_without_erasing_case(self):
        self.assertEqual(without_article("US, the"), "US")
        self.assertNotEqual(without_article("US, the"), without_article("us"))
        self.assertEqual(without_article("the Third World"), without_article("Third World, the"))

    def test_real_content_wins_over_parallel_cyclic_source_redirects(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE source_records(record_index INTEGER PRIMARY KEY,record_key,record_type); CREATE TABLE aliases(source_key,target_record);")
        db.executemany("INSERT INTO source_records VALUES(?,?,?)", [(1, "spelling-a", "redirect"), (2, "spelling-a", "content"), (3, "spelling-b", "redirect"), (4, "spelling-b", "content")])
        db.executemany("INSERT INTO aliases VALUES(?,?)", [("spelling-a", 3), ("spelling-a", 4), ("spelling-b", 1), ("spelling-b", 2)])
        result = resolve_source_redirects(db)
        self.assertEqual(result["errors"], [])
        self.assertEqual(db.execute("SELECT source_key,target_record FROM resolved_source_aliases ORDER BY source_key").fetchall(), [("spelling-a", 4), ("spelling-b", 2)])


if __name__ == "__main__":
    unittest.main()
