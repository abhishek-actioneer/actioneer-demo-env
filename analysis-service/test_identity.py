import unittest

from identity import classify_identification


class IdentifyPolicyTests(unittest.TestCase):
    def test_empty_gallery(self):
        self.assertEqual(classify_identification([], 0.75, 0.08), "empty_gallery")

    def test_unknown_below_threshold(self):
        matches = [{"similarity": 0.72}, {"similarity": 0.20}]
        self.assertEqual(classify_identification(matches, 0.75, 0.08), "unknown")

    def test_ambiguous_top_two(self):
        matches = [{"similarity": 0.86}, {"similarity": 0.82}]
        self.assertEqual(classify_identification(matches, 0.75, 0.08), "ambiguous")

    def test_candidate_with_margin(self):
        matches = [{"similarity": 0.86}, {"similarity": 0.61}]
        self.assertEqual(classify_identification(matches, 0.75, 0.08), "candidate")


if __name__ == "__main__":
    unittest.main()
