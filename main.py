import argparse
import os
import pandas as pd
from modules.crawler import Crawler
from modules.semrush import SemrushClient
from modules.agent import SEOAgent
from modules.reporter import ExcelReportBuilder
from config import Config

def main():
    parser = argparse.ArgumentParser(description="Multifamily SEO Report Generator")
    parser.add_argument("url", help="Client Website URL (e.g., https://www.example-apartments.com)")
    parser.add_argument("--city", help="Target City for Semrush Analysis (e.g., 'Dallas')", required=True)
    parser.add_argument("--output", help="Output filename", default="SEO_Report_Generated.xlsx")
    args = parser.parse_args()

    client_url = args.url
    target_city = args.city
    output_file = args.output
    
    print(f"Starting SEO Report Generation for: {client_url}")
    print(f"Target City: {target_city}")

    # Validate Config
    try:
        Config.validate()
    except ValueError as e:
        print(f"Configuration Error: {e}")
        return

    # 1. Run Crawler
    print("\n--- Step 1: Crawling ---")
    crawler = Crawler()
    temp_dir = "temp_crawl_data"
    try:
        crawler.run_crawl(client_url, temp_dir)
    except Exception as e:
        print(f"Critical Error during crawl: {e}")
        return

    # 2. Semrush Analysis
    print("\n--- Step 2: Semrush Data ---")
    semrush = SemrushClient()
    
    # Domain Overview
    domain = client_url.replace("https://", "").replace("http://", "").split('/')[0]
    domain_data = semrush.get_domain_overview(domain)
    print(f"Domain Overview: {domain_data}")
    
    # Keyword Data
    # Heuristic: Target "apartments in [city]" and "pet friendly apartments [city]"
    target_keywords = [
        f"apartments in {target_city}",
        f"pet friendly apartments {target_city}",
        f"luxury apartments {target_city}",
        f"studio apartments {target_city}"
    ]
    keyword_metrics = semrush.get_keyword_data(target_keywords)
    print(f"Keyword Metrics: {keyword_metrics}")

    # 3. AI Content Generation
    print("\n--- Step 3: AI Analysis & Optimization ---")
    agent = SEOAgent()
    
    # Load internal pages to find candidates
    internal_csv = os.path.join(temp_dir, "internal_all.csv")
    
    onpage_recs = []
    metadata_recs = []
    
    if os.path.exists(internal_csv):
        try:
            # Screaming Frog CSVs usually skip first row or have specific headers. 
            # 'internal_all.csv' headers are usually on row 2 (index 1) if export includes summary, or row 1.
            # We'll assume standard CSV read; might need skiprows=1 if header summary exists.
            # Usually CLI export is clean CSV.
            
            df = pd.read_csv(internal_csv)
            
            # Filter: HTML pages, Status 200
            # Column names depend on SF version. Usually 'Content Type', 'Status Code', 'Address', 'Title 1', 'H1-1'
            # Normalizing column names if needed.
            
            # Identify relevant columns
            cols = df.columns.tolist()
            # Basic check for 'Status Code' or similar
            status_col = next((c for c in cols if 'Status Code' in c), 'Status Code')
            type_col = next((c for c in cols if 'Content' in c), 'Content Type')
            url_col = 'Address'
            title_col = 'Title 1' # or 'Page Title'
            h1_col = 'H1-1' 
            
            # Filter
            if status_col in df.columns and type_col in df.columns:
                # Ensure numeric status
                df[status_col] = pd.to_numeric(df[status_col], errors='coerce')
                candidates = df[
                    (df[status_col] == 200) & 
                    (df[type_col].astype(str).str.contains('text/html', case=False, na=False))
                ]
            else:
                candidates = df
                
            # Pick top 5 based on 'Crawl Depth' (if exists) or just first 5
            # depth_col = 'Crawl Depth'
            # if depth_col in candidates.columns:
            #    candidates = candidates.sort_values(by=depth_col)
            
            top_pages = candidates.head(5)
            
            print(f"Optimizing {len(top_pages)} pages...")
            
            for _, row in top_pages.iterrows():
                url = row.get(url_col, '')
                current_title = row.get(title_col, '')
                current_h1 = row.get(h1_col, '')
                
                # For onpage, we need 'current_content'. 
                # SF doesn't export full body content by default. 
                # We might use 'Meta Description' or just H1 for the prompt as "Intro" is hard to get without custom extraction.
                # The prompt says: "Input: ... Current H1, Top Keywords".
                # Function optimize_onpage requests "Introductory Paragraph".
                # Since we don't have it from standard SF export, we'll pass H1 and maybe Meta Description as context,
                # or just simulate it/ask Agent to write one based on H1.
                # I'll pass Meta Description as 'content' proxy for now.
                current_desc = row.get('Meta Description 1', '')

                # Metadata Optimization
                meta_res = agent.optimize_metadata({
                    "url": url,
                    "current_title": current_title,
                    "keywords": target_keywords
                })
                
                metadata_recs.append({
                    "url": url,
                    "keywords": ", ".join(target_keywords),
                    "current_title": current_title,
                    "proposed_title": meta_res.get('title', ''),
                    "current_desc": current_desc,
                    "proposed_desc": meta_res.get('meta_description', '')
                })
                
                # On-Page Optimization
                onpage_res = agent.optimize_onpage({
                    "url": url,
                    "current_h1": current_h1,
                    "current_content": current_desc, # Proxying
                    "target_keyword": target_keywords[0] # Use primary city keyword
                })
                
                onpage_recs.append({
                    "url": url,
                    "keyword": target_keywords[0],
                    "original_content": f"H1: {current_h1}\nDesc: {current_desc}",
                    "proposed_content": f"H1: {onpage_res.get('h1', '')}\nIntro: {onpage_res.get('content', '')}"
                })
                
        except Exception as e:
            print(f"Error processing internal pages CSV: {e}")

    # 4. Report Generation
    print("\n--- Step 4: Building Report ---")
    reporter = ExcelReportBuilder(output_path=output_file)
    reporter.load_workbook()
    
    # Update Tabs
    reporter.update_technical_seo_tab(temp_dir)
    reporter.create_detailed_audit_tab(temp_dir)
    reporter.update_onpage_recommendations(onpage_recs)
    reporter.update_metadata_tab(metadata_recs)
    
    reporter.save_workbook()
    print("\nDone! Report generated.")

if __name__ == "__main__":
    main()

