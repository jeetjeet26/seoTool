import subprocess
import os
import sys
import re
from urllib.parse import urlparse
from config import Config


class CrawlError(RuntimeError):
    """Raised when Screaming Frog does not produce a usable crawl."""

    def __init__(self, message, stdout="", stderr="", returncode=None):
        super().__init__(message)
        self.stdout = stdout or ""
        self.stderr = stderr or ""
        self.returncode = returncode


# Descriptive aliases for worker/API consumers.
CrawlerError = CrawlError
CrawlExecutionError = CrawlError


class Crawler:
    def __init__(self):
        self.sf_path = Config.SCREAMING_FROG_PATH

    def run_crawl(self, url: str, output_dir: str):
        """
        Executes Screaming Frog in headless mode to crawl the given URL.
        Generates CSV reports in the specified output directory.
        """
        parsed_url = urlparse(url) if isinstance(url, str) else None
        if (
            not parsed_url
            or parsed_url.scheme not in {"http", "https"}
            or not parsed_url.hostname
            or parsed_url.username
            or parsed_url.password
        ):
            raise ValueError("url must be an absolute HTTP(S) URL without credentials")
        if not isinstance(output_dir, (str, os.PathLike)) or not str(output_dir).strip():
            raise ValueError("output_dir must be a non-empty path")

        print(f"Starting crawl for: {url}")
        print(f"Output directory: {output_dir}")

        # Callers should use an audit-specific directory. Never clean the whole
        # directory: it may contain artifacts belonging to another process.
        os.makedirs(output_dir, exist_ok=True)
        internal_export = os.path.join(output_dir, "internal_all.csv")
        if os.path.isfile(internal_export):
            os.unlink(internal_export)

        # Construct the command
        # Note: Enclose paths in quotes if they contain spaces (handled by subprocess list args usually, but be careful)
        cmd = [
            self.sf_path,
            "--crawl", url,
            "--headless",
            "--save-crawl",
            "--output-folder", output_dir,
            "--export-tabs", "Internal:All,Response Codes:Client Error (4xx),Response Codes:Server Error (5xx),Response Codes:No Response,Response Codes:Redirection (3xx),Images:Missing Alt Text,Images:Missing Alt Attribute,Images:Over 100 KB,Page Titles:Missing,Page Titles:Duplicate,Page Titles:Below X Characters,Page Titles:Over 60 Characters,Meta Description:Missing,Meta Description:Duplicate,Meta Description:Over 155 Characters,H1:Missing,H1:Multiple,H1:Duplicate,H2:Missing,H2:Multiple,Canonicals:Missing,Canonicals:Multiple,Canonicals:Canonicalised,Directives:Noindex,Content:Low Content Pages,Content:Exact Duplicates,Security:Missing HSTS Header,Security:Missing X-Frame-Options Header,Security:Missing X-Content-Type-Options Header,Security:Missing Secure Referrer-Policy Header,Security:Missing Content-Security-Policy Header,Security:Mixed Content"
        ]

        try:
            print(f"Running command: {' '.join(cmd)}")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False
            )

            stdout = result.stdout or ""
            stderr = result.stderr or ""
            combined_output = "\n".join((stdout, stderr))
            fatal_lines = [
                line.strip()
                for line in combined_output.splitlines()
                # Match the FATAL log level only, e.g. "[main] FATAL - ...".
                # SF also prints an INFO line "Fatal Log File: ..." on healthy
                # runs, which must not be treated as an error.
                if re.search(r"\bFATAL\s+-\s|^FATAL:", line.strip())
            ]

            if result.returncode != 0 or fatal_lines or not os.path.isfile(internal_export):
                # Surface full Screaming Frog output in worker logs for diagnosis.
                print("Screaming Frog output (tail):")
                print(combined_output[-6000:])

            if result.returncode != 0:
                crash_detail = self._read_crash_file(combined_output)
                detail = "\n".join(
                    part
                    for part in (
                        stdout[-1500:],
                        stderr[-1500:],
                        f"Crash file:\n{crash_detail}" if crash_detail else "",
                    )
                    if part
                )
                raise CrawlError(
                    f"Screaming Frog exited with code {result.returncode}\n{detail}",
                    stdout,
                    stderr,
                    result.returncode,
                )
            if fatal_lines:
                crash_detail = self._read_crash_file(combined_output)
                raise CrawlError(
                    "Screaming Frog reported a fatal error: "
                    + fatal_lines[0]
                    + (f"\nCrash file:\n{crash_detail}" if crash_detail else ""),
                    stdout,
                    stderr,
                    result.returncode,
                )
            if not os.path.isfile(internal_export):
                raise CrawlError(
                    "Screaming Frog returned success but did not create internal_all.csv",
                    stdout,
                    stderr,
                    result.returncode,
                )

            print("Crawl completed successfully.")
            print(stdout)
        except FileNotFoundError:
            raise CrawlError(
                f"Screaming Frog executable not found at {self.sf_path}"
            )

    @staticmethod
    def _read_crash_file(sf_output: str) -> str:
        """Return the tail of the crash file referenced in Screaming Frog output."""
        match = re.search(r"Fatal Log File: (\S+)", sf_output)
        if not match:
            return ""
        try:
            with open(match.group(1), "r", errors="replace") as handle:
                content = handle.read()
        except OSError:
            return ""
        return content[-4000:]

    def verify_output(self, output_dir: str):
        """
        Verifies that the expected CSV files were generated.
        """
        expected_files = [
            "internal_all.csv",
            "response_codes_client_error_4xx.csv",
            "images_missing_alt_text.csv",
            "page_titles_missing.csv",
            "h1_missing.csv"
        ]
        
        missing_files = []
        for file in expected_files:
            if not os.path.exists(os.path.join(output_dir, file)):
                missing_files.append(file)
        
        if missing_files:
            print(f"Warning: The following expected report files were not found: {', '.join(missing_files)}")
            return False
        
        return True

if __name__ == "__main__":
    # Test run
    if len(sys.argv) > 1:
        crawler = Crawler()
        crawler.run_crawl(sys.argv[1], "temp_crawl_output")
    else:
        print("Usage: python -m modules.crawler [url]")

