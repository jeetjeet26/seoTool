# Multifamily SEO Reporting Tool

A comprehensive Python-based tool designed to automate SEO auditing, analysis, and reporting for multifamily real estate websites. This tool orchestrates a workflow that combines technical crawling, keyword market analysis, and AI-driven content optimization into a single, actionable Excel report.

## 🚀 Features

### Core Capabilities
- **Automated Technical Crawl**: Utilizes **Screaming Frog SEO Spider** in headless mode to crawl websites and identify critical technical issues (404 errors, missing H1s, missing alt text, missing canonicals, security headers, etc.).
- **Market Intelligence**: Integrates with the **Semrush API** to fetch domain authority, organic traffic data, and keyword metrics (Volume, KD%) for target local keywords (e.g., "apartments in [City]").
- **AI Content Optimization**: Leverages **Anthropic's Claude Sonnet 4.5** to analyze page content and generate optimized:
  - Title Tags (50-60 characters)
  - Meta Descriptions (150-160 characters)
  - H1 Headers
  - Introductory Paragraphs
  
### AI-Powered Audit Suggestions
The tool now includes **intelligent batch processing** that uses Claude AI to provide specific, actionable suggestions for every issue found:
- **Alt Text Generation**: Analyzes image filenames and page context to suggest descriptive alt text
- **Title Tag Optimization**: Creates SEO-optimized titles based on URL structure and content
- **Meta Description Writing**: Generates compelling meta descriptions with calls-to-action
- **H1 Recommendations**: Suggests keyword-rich H1 headings for pages missing them
- **404 Fix Analysis**: Identifies potential typos and suggests correct URLs
- **Redirect Evaluation**: Analyzes redirect chains and suggests optimization
- **Canonical Tag Recommendations**: Proposes appropriate canonical URLs

### Fair Housing Act Compliance
All AI-generated content is automatically checked for **Fair Housing Act compliance**, ensuring:
- No discriminatory language based on protected classes
- Appropriate terminology (e.g., "primary bedroom" instead of "master bedroom")
- Focus on property features rather than who should live there
- Safe, welcoming language for all potential residents

### Excel Reporting
Auto-generates a detailed `.xlsx` report containing:
- **Technical SEO**: Summary of crawl errors with counts
- **Detailed Audit Logs**: Row-by-row actionable fixes with current page context (title, H1, meta description) and AI-generated suggestions
- **On-Page Recommendations**: AI-suggested content improvements side-by-side with current content
- **Metadata Optimization**: Comprehensive comparison showing current vs. proposed titles, H1s, and meta descriptions with character counts

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

### What to Expect

When you run the tool, it will:
1. **Validate Configuration**: Checks for required API keys and Screaming Frog installation
2. **Crawl Website**: Uses Screaming Frog to crawl and export data (progress shown in terminal)
3. **Fetch Market Data**: Retrieves domain metrics and keyword data from Semrush
4. **AI Analysis**: Processes top 5 pages with Claude AI for content optimization
5. **Batch AI Processing**: Generates specific fix suggestions for all identified issues
   - Shows progress for each batch (e.g., "Processing batch 1/3 (50 items)...")
   - Covers 404s, alt text, titles, meta descriptions, H1s, canonicals, and more
6. **Report Generation**: Compiles everything into a professional Excel report

The entire process typically takes **10-20 minutes** depending on site size and number of issues found.

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

### 1. Technical SEO
High-level statistics summarizing crawl health, including counts of:
- 404 errors
- Missing alt text
- Other critical issues

### 2. Detailed Audit Logs (Enhanced with AI)
Comprehensive URL-level issues with context and AI-powered suggestions:
- **Current Page Context**: Shows existing Title, H1, and Meta Description for each issue
- **Issue Types Covered**:
  - 404 Errors (with smart fix suggestions)
  - 3xx Redirects (with evaluation and recommendations)
  - Missing/Empty Alt Text (with generated descriptive alt text)
  - Missing/Multiple H1 Tags (with suggested H1s)
  - Missing/Short Title Tags (with optimized suggestions)
  - Missing Meta Descriptions (with compelling descriptions)
  - Missing Canonical Tags (with appropriate canonical URLs)
  - Security Header Issues
  - URL Parameter Issues
- **AI-Generated Suggestions**: Each issue includes a specific, actionable fix rather than generic advice

### 3. On-Page Recommendations
Side-by-side comparison of current vs. proposed content:
- Web Page URL
- Targeted Keywords
- Current Title → Proposed Title
- Current H1 → Proposed H1
- Current Meta Description → Proposed Meta Description
- Original Content → Proposed Content (when available)

### 4. Metadata Optimization
Comprehensive metadata analysis with character counts:
- URL and target keywords
- Current Title (with length)
- Proposed Title (with length)
- Current H1
- Current Meta Description (with length)
- Proposed Meta Description (with length)

All content is optimized for SEO while maintaining **Fair Housing Act compliance**.

## ⚡ Performance & Efficiency

The tool uses **intelligent batch processing** to handle large-scale audits efficiently:
- Processes up to 50 issues per API call to minimize latency
- Provides detailed progress updates during batch processing
- Gracefully handles API errors with fallback suggestions
- Optimizes token usage for cost-effective operation

## 🔒 Compliance & Safety

This tool is specifically designed for the multifamily real estate industry with built-in safeguards:
- **Fair Housing Act Compliance**: All AI-generated content is checked against FHA guidelines
- **Industry Best Practices**: Follows SEO best practices for real estate websites
- **Safe Language**: Avoids discriminatory terms and focuses on property features
- **Human Review**: All AI suggestions should be reviewed before implementation

## 🎯 Use Cases

Perfect for:
- Property management companies managing multiple apartment communities
- Real estate marketing agencies serving multifamily clients
- In-house SEO teams at apartment REITs
- Digital marketers specializing in multifamily properties

## 📊 Example Workflow

1. **Crawl**: Tool crawls your apartment community website (5-10 minutes)
2. **Analyze**: Fetches competitive data from Semrush and processes with AI (5-10 minutes)
3. **Report**: Generates comprehensive Excel report with specific, actionable recommendations
4. **Review**: Review AI suggestions for accuracy and brand voice
5. **Implement**: Use the report to guide your development and content teams

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.



