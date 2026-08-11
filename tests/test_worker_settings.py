import os
import unittest
from unittest.mock import patch

from worker.settings import WorkerConfigurationError, WorkerSettings


class WorkerSettingsTests(unittest.TestCase):
    def test_loads_required_settings(self):
        env = {
            "SUPABASE_DB_URL": "postgresql://example",
            "NEXT_PUBLIC_SUPABASE_URL": "https://project.supabase.co/",
            "SUPABASE_SERVICE_ROLE_KEY": "test-only-key",
            "SEMRUSH_API_KEY": "test-semrush-key",
            "ANTHROPIC_API_KEY": "test-anthropic-key",
            "GOOGLE_MAPS_API_KEY": "test-google-key",
            "WORKER_POLL_SECONDS": "7",
            "AUDIT_WORK_ROOT": "/tmp/audits",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = WorkerSettings.from_env()

        self.assertEqual(settings.poll_seconds, 7)
        self.assertEqual(settings.supabase_url, "https://project.supabase.co")
        self.assertEqual(str(settings.work_root), "/tmp/audits")
        self.assertEqual(settings.google_maps_api_key, "test-google-key")

    def test_rejects_missing_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(WorkerConfigurationError):
                WorkerSettings.from_env()

    def test_rejects_poll_interval_below_one_second(self):
        env = {
            "SUPABASE_DB_URL": "postgresql://example",
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-only-key",
            "SEMRUSH_API_KEY": "test-semrush-key",
            "ANTHROPIC_API_KEY": "test-anthropic-key",
            "WORKER_POLL_SECONDS": "0",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(WorkerConfigurationError):
                WorkerSettings.from_env()


if __name__ == "__main__":
    unittest.main()
