# Multifamily SEO Reporting Tool - Implementation Guide

## **1. Tech Stack & Dependencies**

* **Language:** Python 3.9+
* **Key Libraries:**
    * `pandas`: For data manipulation.
    * `openpyxl`: For reading/writing the specific Excel template (preserving formatting).
    * `anthropic`: For interfacing with Claude 3.5 Sonnet (The SEO Agent).
    * `requests`: For Semrush API calls.
    * `subprocess`: For running Screaming Frog in Headless mode.
* **External Tools:**
    * **Screaming Frog SEO Spider**: Must be installed locally. We will use the Command Line Interface (CLI).
    * **Semrush API**: Requires an API key.

## **2. Architecture Overview**

The tool should be modular. Create the following file structure:

* `main.py`: Orchestrator script.
* `config.py`: Stores API keys (`SEMRUSH_KEY`, `ANTHROPIC_KEY`) and paths (`SF_PATH`).
* `modules/crawler.py`: Handles Screaming Frog CLI execution.
* `modules/semrush.py`: Handles Keyword and Domain analytics.
* `modules/agent.py`: The "Brain". Uses Claude to write copy and strategy.
* `modules/reporter.py`: Compiles data and writes to the Excel template.

## **3. Step-by-Step Implementation Guide**

### **Step 1: Configuration (`config.py`)**

* Define `SF_HEADLESS_PATH`: Path to the Screaming Frog executable (e.g., `/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher` or Windows equivalent).
* Define API keys for Semrush and Anthropic.
* Load environment variables safely (e.g., using `python-dotenv`).

### **Step 2: The Crawler (`modules/crawler.py`)**

* **Function:** `run_crawl(url, output_dir)`
* **Logic:**
    * Use `subprocess` to run Screaming Frog in headless mode.
    * **Command Flags:**
        * `--crawl [url]`
        * `--headless`
        * `--save-crawl` (optional, but good for debugging)
        * `--output-folder [output_dir]`
        * `--export-tabs "Internal:All,Response Codes:Client Error (4xx),Images:Missing Alt Text,Page Titles:Missing,H1:Missing"`
    * **Goal:** Generate CSV files in the `output_dir` that contain the raw crawl data.

### **Step 3: Semrush Data (`modules/semrush.py`)**

* **Function:** `get_domain_overview(domain)`
    * Use `domain_rank` endpoint to get current organic traffic and keywords.
* **Function:** `get_keyword_data(keywords_list)`
    * Use `keyword_overview` endpoint to get Search Volume and KD% for target keywords (e.g., "apartments in [city]", "pet friendly apartments [city]").

### **Step 4: The SEO Agent (`modules/agent.py`)**

* **Model:** Use `claude-3-5-sonnet`.
* **Task:** This module processes data row-by-row to generate creative content.
* **Prompting Strategy:**
    * **Input:** Current Page URL, Current Title, Current H1, Top Keywords for this page.
    * **System Prompt:** "You are an expert Real Estate SEO Copywriter. Your tone is luxury, welcoming, and professional."
    * **Function:** `optimize_metadata(page_data)`
        * *Request:* "Write a new Title Tag (< 60 chars) and Meta Description (< 160 chars) for this page using these keywords: [list]. Ensure it mentions the location."
    * **Function:** `optimize_onpage(page_data)`
        * *Request:* "Rewrite the following H1 and Introductory Paragraph to better target [keyword]. Keep the HTML formatting tags if present."

### **Step 5: The Report Builder (`modules/reporter.py`)**

* **Logic:** Load the template `SCD - Kahuina SEO Report.xlsx` using `openpyxl`. Fill in data without breaking styles.

#### **Tab A: "Technical SEO"**
* **Source:** Screaming Frog CSVs.
* **Action:**
    * Count rows in `response_codes_client_error_4xx.csv` -> Write count to "Occurrences" column for "Broken Links".
    * Count rows in `images_missing_alt_text.csv` -> Write count to "Occurrences" for "Missing Alt Text".
    * Update "Date Discovered" to today's date.

#### **Tab B: "Detailed Audit Logs" (NEW TAB)**
* **Requirement:** The user specifically requested "actual locations in the code."
* **Action:** Create a NEW sheet.
* **Columns:** `Issue Type`, `Page URL`, `Element/Details`, `Suggested Fix`.
* **Data Logic:**
    * Iterate through the specific Screaming Frog error CSVs.
    * For every 404: Add row -> `[ "404 Error", Source URL, "Linked to: " + Destination URL, "Update link or remove" ]`.
    * For every Missing Alt: Add row -> `[ "Missing Alt", Source URL, "Image: " + Image URL, "Add descriptive alt text" ]`.

#### **Tab C: "On-Page Recommendations"**
* **Format:** This tab uses a "Block" format (not a simple table). It groups cells by "Web Page", "Targeted Keyword", "Original Copy", "Proposed Copy".
* **Logic:**
    * Identify the top 5-10 pages to optimize.
    * Call `agent.optimize_onpage()` for each.
    * Use `openpyxl` to insert text into the specific cell blocks (e.g., Row 1=URL, Row 2=Keywords, Row 3=Original, Row 4=Proposed).

#### **Tab D: "Title Tags" & "Meta Descriptions"**
* **Source:** `internal_all.csv` (Current) + `agent.optimize_metadata()` (Proposed).
* **Action:** Fill the table rows: `URL` | `Keywords` | `Current` | `Proposed` | `Length`.

## **4. Execution Flow**

1.  `main.py` reads the input URL.
2.  `crawler.py` runs and dumps CSVs to a `/temp` folder.
3.  `semrush.py` fetches volume for "apartments in [city]".
4.  `agent.py` reads the CSVs, picks the top pages, and generates the optimized copy.
5.  `reporter.py` loads the Excel Template, populates the summary tabs, creates the "Detailed Audit" tab, and saves as `[Client_Name]_SEO_Report_Generated.xlsx`.

