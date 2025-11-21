import subprocess
import os
import sys
from config import Config

class Crawler:
    def __init__(self):
        self.sf_path = Config.SCREAMING_FROG_PATH

    def run_crawl(self, url: str, output_dir: str):
        """
        Executes Screaming Frog in headless mode to crawl the given URL.
        Generates CSV reports in the specified output directory.
        """
        print(f"Starting crawl for: {url}")
        print(f"Output directory: {output_dir}")

        # Ensure output directory exists and is empty
        if os.path.exists(output_dir):
            for file in os.listdir(output_dir):
                file_path = os.path.join(output_dir, file)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                except Exception as e:
                    print(f"Error deleting file {file_path}: {e}")
        
        os.makedirs(output_dir, exist_ok=True)

        # Construct the command
        # Note: Enclose paths in quotes if they contain spaces (handled by subprocess list args usually, but be careful)
        cmd = [
            self.sf_path,
            "--crawl", url,
            "--headless",
            "--save-crawl",
            "--output-folder", output_dir,
            "--export-tabs", "Internal:All,Response Codes:Client Error (4xx),Response Codes:Redirection (3xx),Images:Missing Alt Text,Images:Missing Alt Attribute,Page Titles:Missing,Page Titles:Below X Characters,Meta Description:Missing,H1:Missing,H1:Multiple,H2:Multiple,Canonicals:Missing,Security:Missing HSTS Header,Security:Missing X-Frame-Options Header,Security:Missing X-Content-Type-Options Header,Security:Missing Secure Referrer-Policy Header,Security:Missing Content-Security-Policy Header"
        ]

        try:
            print(f"Running command: {' '.join(cmd)}")
            # Run the command
            result = subprocess.run(
                cmd, 
                capture_output=True, 
                text=True, 
                check=True
            )
            
            print("Crawl completed successfully.")
            print(result.stdout)
            
        except subprocess.CalledProcessError as e:
            print(f"Error running Screaming Frog: {e}")
            print(f"Stdout: {e.stdout}")
            print(f"Stderr: {e.stderr}")
            raise
        except FileNotFoundError:
             print(f"Error: Screaming Frog executable not found at {self.sf_path}. Please check your configuration.")
             raise
        except Exception as e:
            print(f"An unexpected error occurred during the crawl: {e}")
            raise

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

