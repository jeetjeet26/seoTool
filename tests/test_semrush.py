import unittest
from unittest.mock import patch

from modules.semrush import SemrushClient


class FakeResponse:
    def __init__(self, text: str = "", payload=None, status_code: int = 200):
        self.text = text
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        if self.payload is None:
            raise ValueError("No JSON payload")
        return self.payload


def make_client() -> SemrushClient:
    with patch("modules.semrush.Config") as config:
        config.SEMRUSH_API_KEY = "test-key"
        client = SemrushClient.__new__(SemrushClient)
        client.api_key = "test-key"
    return client


class SemrushReportTests(unittest.TestCase):
    def test_parses_organic_positions(self):
        body = (
            "Keyword;Position;Search Volume;CPC;Competition;Keyword Difficulty;Url;Traffic (%)\n"
            "apartments long beach;7;720;1.20;0.45;38;https://example.com/;12.5\n"
        )
        client = make_client()
        with patch("modules.semrush.requests.get", return_value=FakeResponse(body)):
            rows = client.get_organic_positions("example.com")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["keyword"], "apartments long beach")
        self.assertEqual(rows[0]["position"], 7)
        self.assertEqual(rows[0]["volume"], 720)
        self.assertEqual(rows[0]["landing_page"], "https://example.com/")

    def test_parses_related_keyword_difficulty_index_header(self):
        body = (
            "Keyword;Search Volume;CPC;Competition;Keyword Difficulty Index\n"
            "apartments long beach;9900;0.59;0.72;55\n"
        )
        client = make_client()
        with patch("modules.semrush.requests.get", return_value=FakeResponse(body)):
            rows = client.get_keyword_ideas("apartments in long beach")
        self.assertEqual(rows[0]["difficulty"], 55)

    def test_skips_malformed_rows(self):
        body = (
            "Keyword;Position;Search Volume;CPC;Competition;Keyword Difficulty;Url;Traffic (%)\n"
            "broken row without separators\n"
            "good keyword;3;100;0.5;0.2;20;https://example.com/a;1\n"
        )
        client = make_client()
        with patch("modules.semrush.requests.get", return_value=FakeResponse(body)):
            rows = client.get_organic_positions("example.com")
        self.assertEqual([row["keyword"] for row in rows], ["good keyword"])

    def test_error_body_returns_empty(self):
        client = make_client()
        with patch(
            "modules.semrush.requests.get",
            return_value=FakeResponse("ERROR 50 :: NOTHING FOUND"),
        ):
            self.assertEqual(client.get_organic_positions("example.com"), [])
        self.assertEqual(client.consume_diagnostics(), [])

    def test_parses_backlinks_overview(self):
        client = make_client()
        with patch(
            "modules.semrush.requests.get",
            return_value=FakeResponse(
                "ascore;total;domains_num;urls_num;ips_num\n"
                "34;1200;85;400;60\n"
            ),
        ):
            overview = client.get_backlinks_overview("example.com")
        self.assertEqual(overview["authority_score"], 34)
        self.assertEqual(overview["referring_domains"], 85)

    def test_diagnostics_redact_api_keys(self):
        client = make_client()
        client._diagnostic("request failed: https://api.semrush.com/?key=test-key&type=x")
        diagnostic = client.consume_diagnostics()[0]
        self.assertNotIn("test-key", diagnostic)
        self.assertIn("[REDACTED]", diagnostic)

    def test_expected_missing_site_audit_does_not_emit_raw_404(self):
        client = make_client()
        client.diagnostics = []
        with patch(
            "modules.semrush.requests.get",
            return_value=FakeResponse(status_code=404),
        ):
            result = client._project_json(
                "https://api.semrush.com/reports/v1/projects/1/siteaudit/info",
                ignore_not_found=True,
            )
        self.assertEqual(result, {})
        self.assertEqual(client.consume_diagnostics(), [])

    def test_parses_competitors(self):
        body = (
            "Domain;Competitor Relevance;Common Keywords;Organic Keywords;Organic Traffic\n"
            "rival.com;0.31;44;900;15000\n"
        )
        client = make_client()
        with patch("modules.semrush.requests.get", return_value=FakeResponse(body)):
            rows = client.get_competitors("example.com")
        self.assertEqual(rows[0]["domain"], "rival.com")
        self.assertEqual(rows[0]["common_keywords"], 44)


if __name__ == "__main__":
    unittest.main()
