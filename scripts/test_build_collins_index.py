import unittest

from build_collins_index import sense_rows


class CollinsExtractionTests(unittest.TestCase):
    def test_extracts_embedded_phrase_and_keeps_examples_as_examples(self):
        html = '''<h2> friend </h2><img/>
        <span class="bold">friend friends</span><font class="calibre_14">[N-COUNT]</font><br/>
        A friend is someone you know well.<br/><img/>
        <font class="calibre_21">My friend has a family dog.</font><img/>
        <span class="bold">friend</span><font class="calibre_14">[PHR-RECIP]</font><br/>
        If you <dfn>make friends</dfn> with someone, you become friends.<br/><img/>
        <font class="calibre_21">They made friends quickly.</font><img/>'''
        rows = list(sense_rows(html))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][4], [])
        self.assertIn('family dog', rows[0][3][0])
        self.assertEqual(rows[1][4], ['make friends'])
        self.assertEqual(rows[1][3], ['They made friends quickly.'])

    def test_independent_phrasal_verb_keeps_distinct_senses(self):
        html = '''<h2> take off </h2><img/>
        <span class="bold">take off</span><font class="calibre_14">[PHR-V]</font><br/>
        A plane takes off when it leaves the ground.<img/>
        <span class="bold">take off</span><font class="calibre_14">[PHR-V]</font><br/>
        A business takes off when it becomes successful.<img/>'''
        rows = list(sense_rows(html))
        self.assertEqual([row[4] for row in rows], [['take off'], ['take off']])
        self.assertNotEqual(rows[0][2], rows[1][2])

    def test_homograph_number_is_not_a_phrase(self):
        html = '''<h2> take 2 </h2><img/>
        <span class="bold">take</span><font class="calibre_14">[VB]</font><br/>
        To take something is to obtain it.<img/>'''
        row, = list(sense_rows(html))
        self.assertEqual(row[0], 'take 2')
        self.assertEqual(row[4], [])
        self.assertFalse(row[5])

    def test_editorial_phrase_in_bold_without_dfn_is_indexed(self):
        html = '''<h2> along </h2><img/>
        <span class="bold">along</span><font class="calibre_14">[PHR-PREP]</font><br/>
        You use <span class="bold">along with</span> to mention another person.<img/>'''
        row, = list(sense_rows(html))
        self.assertEqual(row[4], ['along with'])


if __name__ == '__main__':
    unittest.main()
