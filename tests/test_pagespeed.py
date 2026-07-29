import unittest

from modules.pagespeed import PageSpeedClient, PageSpeedError


class FakeResponse:
    def __init__(self, payload, status_error=None):
        self.payload = payload
        self.status_error = status_error

    def raise_for_status(self):
        if self.status_error:
            raise self.status_error

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, params, timeout):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        return self.response


class PageSpeedClientTests(unittest.TestCase):
    def test_extracts_scores_metrics_and_failed_accessibility_audits(self):
        response = FakeResponse(
            {
                "lighthouseResult": {
                    "fetchTime": "2026-07-28T00:00:00Z",
                    "finalDisplayedUrl": "https://example.com/",
                    "categories": {
                        "performance": {"score": 0.91},
                        "accessibility": {
                            "score": 0.84,
                            "auditRefs": [
                                {"id": "image-alt"},
                                {"id": "document-title"},
                            ],
                        },
                    },
                    "audits": {
                        "largest-contentful-paint": {
                            "displayValue": "2.1 s",
                            "numericValue": 2100,
                            "score": 0.82,
                        },
                        "image-alt": {
                            "title": "Image elements have alt attributes",
                            "description": "Add alternative text.",
                            "score": 0,
                            "details": {"items": [{"node": {"selector": "img.hero"}}]},
                        },
                        "document-title": {
                            "title": "Document has a title",
                            "score": 1,
                        },
                    },
                }
            }
        )
        session = FakeSession(response)
        client = PageSpeedClient(session=session)

        result = client.analyze_url("https://example.com/")

        self.assertEqual(result["performance_score"], 91)
        self.assertEqual(result["accessibility_score"], 84)
        self.assertEqual(
            result["metrics"]["largest_contentful_paint"]["numeric_value"], 2100
        )
        self.assertEqual(len(result["accessibility_issues"]), 1)
        self.assertEqual(result["accessibility_issues"][0]["id"], "image-alt")

    def test_rejects_payload_without_lighthouse_result(self):
        client = PageSpeedClient(session=FakeSession(FakeResponse({"error": {}})))

        with self.assertRaises(PageSpeedError):
            client.analyze_url("https://example.com/")

    def test_limits_and_deduplicates_urls(self):
        session = FakeSession(
            FakeResponse(
                {
                    "lighthouseResult": {
                        "categories": {},
                        "audits": {},
                    }
                }
            )
        )
        client = PageSpeedClient(session=session)

        results = client.analyze_urls(
            ["https://a.example", "https://a.example", "https://b.example"],
            limit=1,
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(len(session.calls), 1)


if __name__ == "__main__":
    unittest.main()
