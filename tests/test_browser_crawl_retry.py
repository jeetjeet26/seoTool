import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.crawler import Crawler
from tests.test_audit_engine import write_csv


class BrowserCrawlRetryTests(unittest.TestCase):
    def run_scenario(self, first, second=None, failed=False):
        commands = []
        urls = ['https://example.com/a', 'https://example.com/b']
        def execute(command, **kwargs):
            commands.append(command)
            output = Path(command[command.index('--output-folder') + 1])
            scope = Path(command[command.index('--crawl-list') + 1])
            self.assertEqual(scope.read_text().splitlines(), urls)
            browser = '--config' in command
            if browser:
                self.assertTrue(Path(command[command.index('--config') + 1]).is_file())
                self.assertEqual(kwargs['timeout'], 600)
                if failed:
                    raise subprocess.TimeoutExpired(command, 600)
            statuses = second if browser else first
            write_csv(output / 'internal_all.csv', [
                {'Address': url, 'Status Code': status, 'Content Type': 'text/html'}
                for url, status in zip(urls, statuses)
            ])
            if browser:
                write_csv(output / 'h1_missing.csv', [{'Address': urls[0]}])
            else:
                write_csv(output / 'response_codes_client_error_(4xx).csv', [{'Address': urls[0], 'Status Code': '403'}])
            return subprocess.CompletedProcess(command, 0, '', '')
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'crawl'
            output.mkdir()
            (output / 'keep.txt').write_text('keep')
            with patch('modules.crawler.validate_public_audit_url', side_effect=lambda u: u), patch('modules.crawler.subprocess.run', side_effect=execute):
                Crawler().run_crawl(urls[0], str(output), allowed_urls=urls)
            self.assertEqual((output / 'keep.txt').read_text(), 'keep')
            report = json.loads((output / 'crawl_attempts.json').read_text())
            files = {p.name for p in output.iterdir()}
        return commands, report, files

    def test_blocked_crawl_recovers_full_exports_with_same_scope(self):
        commands, report, files = self.run_scenario(['403', '403'], ['200', '200'])
        self.assertEqual(len(commands), 2)
        self.assertEqual(report['selected_profile'], 'browser')
        self.assertEqual(report['attempts'][1]['html_pages'], 2)
        self.assertIn('h1_missing.csv', files)
        self.assertNotIn('response_codes_client_error_(4xx).csv', files)
        self.assertEqual(commands[0][-1], commands[1][-1])  # complete export tabs

    def test_partial_block_retries_and_keeps_better_inventory(self):
        _, report, _ = self.run_scenario(['200', '403'], ['200', '200'])
        self.assertEqual(report['selected_profile'], 'browser')

    def test_no_retry_for_success_or_rate_limits(self):
        for statuses in [['200', '200'], ['429', '403'], ['404', '404']]:
            with self.subTest(statuses=statuses):
                commands, report, _ = self.run_scenario(statuses)
                self.assertEqual(len(commands), 1)
                self.assertEqual(report['selected_profile'], 'default')

    def test_failed_retry_preserves_original_exports(self):
        for failed in [True, False]:
            with self.subTest(failed=failed):
                commands, report, files = self.run_scenario(['403', '403'], ['403', '403'], failed=failed)
                self.assertEqual(len(commands), 2)
                self.assertEqual(report['selected_profile'], 'default')
                self.assertIn('response_codes_client_error_(4xx).csv', files)
                self.assertNotIn('h1_missing.csv', files)
