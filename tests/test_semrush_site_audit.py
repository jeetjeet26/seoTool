import unittest
from unittest.mock import patch
import requests
from modules.semrush import SemrushClient, SiteAuditError, _normalize_domain
from tests.test_semrush import FakeResponse, make_client

PROJECT = {'project_id': 1, 'project_name': 'Client', 'url': 'https://www.example.com/'}
SNAPSHOTS = {'snapshots': [{'snapshot_id': 's1', 'finish_date': 100}]}
SNAPSHOT = {'snapshot_id': 's1', 'pages_crawled': 2, 'errors': [{'id': 1, 'count': 1}], 'quality': {'value': 80}}


class SiteAuditAutomationTests(unittest.TestCase):
    def test_existing_completed_audit_uses_documented_snapshot_endpoint(self):
        c = make_client()
        def get(url, **kw):
            if url.endswith('/projects'): return FakeResponse(payload=[PROJECT])
            if url.endswith('/info'): return FakeResponse(payload={'status': 'FINISHED'})
            if url.endswith('/snapshots'): return FakeResponse(payload=SNAPSHOTS)
            if url.endswith('/snapshot'):
                self.assertEqual(kw['params']['snapshot_id'], 's1')
                return FakeResponse(payload=SNAPSHOT)
            if url.endswith('/meta/issues'): return FakeResponse(payload={'issues': [{'id': 1, 'title': 'Broken link'}]})
            return FakeResponse(payload={'data': [{'source_url': 'https://example.com/a', 'target_url': 'https://example.com/missing'}], 'total': 1})
        with patch('modules.semrush.requests.get', side_effect=get), patch('modules.semrush.requests.post') as post:
            result = c.get_site_audit('https://example.com/')
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['findings'][0]['page_url'], 'https://example.com/a')
        self.assertEqual(result['pages_crawled'], 2)
        self.assertFalse(result['project_created'])
        post.assert_not_called()

    def test_missing_project_is_created_enabled_launched_and_imported(self):
        c = make_client(); info_calls = 0; snapshot_calls = 0; writes = []
        def get(url, **kw):
            nonlocal info_calls, snapshot_calls
            if url.endswith('/projects'): return FakeResponse(payload=[])
            if url.endswith('/info'):
                info_calls += 1
                if info_calls == 1: return FakeResponse(status_code=404)
                return FakeResponse(payload={'status': 'FINISHED' if info_calls >= 3 else 'READY'})
            if url.endswith('/snapshots'):
                snapshot_calls += 1
                return FakeResponse(payload=SNAPSHOTS if snapshot_calls > 1 else {'snapshots': []})
            if url.endswith('/snapshot'): return FakeResponse(payload={**SNAPSHOT, 'errors': []})
            return FakeResponse(payload={'issues': []})
        def post(url, **kw):
            writes.append((url, kw.get('json')))
            if url.endswith('/projects'): return FakeResponse(payload=PROJECT)
            if url.endswith('/launch'): return FakeResponse(payload={'snapshot_id': 's1'})
            return FakeResponse(payload={})
        with patch('modules.semrush.requests.get', side_effect=get), patch('modules.semrush.requests.post', side_effect=post), patch('modules.semrush.time.sleep'):
            result = c.get_site_audit('https://www.example.com/community/', page_limit=25)
        self.assertTrue(result['project_created'])
        self.assertEqual([url.rsplit('/', 1)[-1] for url, _ in writes], ['projects', 'enable', 'launch'])
        self.assertEqual(writes[1][1]['domain'], 'www.example.com/community/')
        self.assertEqual(writes[1][1]['pageLimit'], 25)
        self.assertFalse(writes[1][1]['notify'])
        self.assertEqual(writes[1][1]['scheduleDay'], 0)

    def test_running_audit_is_not_relaunched_and_timeout_is_explicit(self):
        c = make_client()
        with patch.object(c, '_project_json', side_effect=[[PROJECT], {'status': 'RUNNING'}, {'snapshots': []}]) as api:
            with self.assertRaises(SiteAuditError) as error:
                c.get_site_audit('https://example.com/', wait_seconds=0)
        self.assertEqual(error.exception.code, 'in_progress')
        self.assertFalse(any(call.kwargs.get('method') == 'POST' for call in api.call_args_list))

    def test_project_list_failures_do_not_create_projects(self):
        c = make_client()
        for status, code in [(401, 'authentication'), (403, 'access_denied'), (429, 'rate_limit'), (402, 'quota')]:
            with self.subTest(status=status), patch('modules.semrush.requests.get', return_value=FakeResponse(payload={'error': 'limit test-key'}, status_code=status)), patch('modules.semrush.requests.post') as post:
                with self.assertRaises(SiteAuditError) as error:
                    c.get_site_audit('https://example.com/')
                self.assertEqual(error.exception.code, code)
                self.assertNotIn('test-key', str(error.exception))
                post.assert_not_called()

    def test_ambiguous_create_timeout_is_not_retried(self):
        c = make_client()
        with patch('modules.semrush.requests.get', return_value=FakeResponse(payload=[])), patch('modules.semrush.requests.post', side_effect=requests.Timeout('key=test-key')) as post:
            with self.assertRaises(SiteAuditError) as error:
                c.get_site_audit('https://example.com/')
        self.assertEqual(error.exception.code, 'network_error')
        self.assertNotIn('test-key', str(error.exception))
        self.assertEqual(post.call_count, 1)

    def test_wrong_configured_project_never_creates_or_imports(self):
        c = make_client()
        with patch.object(c, '_project_json', return_value=[PROJECT]):
            with self.assertRaises(SiteAuditError) as error:
                c.get_site_audit('https://other.com/', '1')
        self.assertEqual(error.exception.code, 'domain_mismatch')

    def test_http_200_error_body_is_not_empty_success(self):
        c = make_client()
        with patch('modules.semrush.requests.get', return_value=FakeResponse('ERROR 120 :: API units exhausted')):
            with self.assertRaisesRegex(SiteAuditError, 'API units exhausted'):
                c.get_site_audit('https://example.com/')

    def test_domain_matching_normalizes_url_schemes_and_www(self):
        self.assertEqual(_normalize_domain('https://www.Example.com/path/'), 'example.com')

    def test_other_automated_community_project_is_not_reused(self):
        from modules.semrush import _site_audit_project_name
        c = make_client()
        project = {**PROJECT, 'project_name': _site_audit_project_name('https://example.com/community-a/')}
        with patch.object(c, '_project_json', return_value=[project]):
            self.assertEqual(c._find_project('example.com', '', 'https://example.com/community-b/'), {})
