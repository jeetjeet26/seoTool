# Multifamily SEO Reporting Tool

A comprehensive Python-based tool designed to automate SEO auditing, analysis, and reporting for multifamily real estate websites. This tool orchestrates a workflow that combines technical crawling, keyword market analysis, and AI-driven content optimization into a single, actionable Excel report.

## 🚀 Features

- **Automated Technical Crawl**: Utilizes **Screaming Frog SEO Spider** in headless mode to crawl websites and identify critical technical issues (404 errors, missing H1s, missing alt text, etc.).
- **Market Intelligence**: Integrates with the **Semrush API** to fetch domain authority, organic traffic data, and keyword metrics (Volume, KD%) for target local keywords (e.g., "apartments in [City]").
- **AI Content Optimization**: Leverages **Anthropic's Claude 3.5 Sonnet** to analyze page content and generate optimized:
  - Title Tags
  - Meta Descriptions
  - H1 Headers
  - Introductory Paragraphs
- **Excel Reporting**: auto-generates a detailed `.xlsx` report containing:
  - **Technical SEO**: Summary of crawl errors.
  - **Detailed Audit Logs**: Row-by-row actionable fixes for broken links and image issues.
  - **On-Page Recommendations**: AI-suggested content improvements side-by-side with original text.
  - **Metadata Optimization**: Proposed title tags and meta descriptions for top pages.

## 📋 Prerequisites

Before running the tool, ensure you have the following:

1.  **Python 3.9+** installed.
2.  **Screaming Frog SEO Spider** installed locally on your machine.
    *   *Note: The tool requires the path to the Screaming Frog executable.*
3.  **API Keys**:
    *   **Semrush API Key**: For keyword and domain data.
    *   **Anthropic API Key**: For AI content generation.

## 🛠️ Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/jeetjeet26/seoTool.git
    cd seoTool
    ```

2.  **Install Python dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

3.  **Configure Environment Variables**:
    Create a `.env` file in the root directory (based on `config.py` expectations) or ensure `config.py` can access the following variables:
    
    *   `SEMRUSH_API_KEY`
    *   `ANTHROPIC_API_KEY`
    *   `SF_HEADLESS_PATH` (Path to your local Screaming Frog executable)

## 🏃 Usage

Run the tool via the command line, specifying the target URL and the city for local SEO context.

```bash
python main.py "https://www.example-apartments.com" --city "Dallas"
```

### Arguments
- `url`: The full URL of the multifamily property website to audit.
- `--city`: The target city name (used to seed keyword research, e.g., "apartments in [city]").
- `--output` (Optional): Custom filename for the generated Excel report (default: `SEO_Report_Generated.xlsx`).

## 📂 Project Structure

```text
seoTool/
├── main.py                 # Orchestrator script handling the CLI and workflow
├── config.py               # Configuration and environment variable management
├── implementation.md       # Technical implementation details and notes
├── requirements.txt        # Python dependencies
├── modules/
│   ├── agent.py            # AI logic (Anthropic Claude integration)
│   ├── crawler.py          # Screaming Frog CLI wrapper
│   ├── semrush.py          # Semrush API client
│   └── reporter.py         # Excel report generation logic
└── temp_crawl_data/        # Temporary directory for raw crawl CSVs (ignored by git)
```

## 📝 Output

The tool generates an Excel file (e.g., `SEO_Report_Generated.xlsx`) with the following tabs:
1.  **Technical SEO**: High-level stats on crawl health.
2.  **Detailed Audit Logs**: Specific URL-level issues (4xx errors, missing alts).
3.  **On-Page Recommendations**: AI-generated content improvements.
4.  **Title Tags & Meta Descriptions**: Optimized metadata suggestions.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

