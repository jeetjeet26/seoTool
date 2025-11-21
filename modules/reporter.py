import pandas as pd
import openpyxl
from openpyxl.utils.dataframe import dataframe_to_rows
from openpyxl.styles import Font, Alignment
import os
from datetime import datetime

class ExcelReportBuilder:
    def __init__(self, template_path="SCD - Kahuina SEO Report.xlsx", output_path="SEO_Report_Generated.xlsx"):
        self.template_path = template_path
        self.output_path = output_path
        self.wb = None

    def load_workbook(self):
        if not os.path.exists(self.template_path):
            print(f"Error: Template file '{self.template_path}' not found.")
            # For development purposes, create a blank workbook if template is missing
            # But in production, we really need the template.
            self.wb = openpyxl.Workbook()
            print("Created a new blank workbook instead.")
        else:
            self.wb = openpyxl.load_workbook(self.template_path)

    def save_workbook(self):
        if self.wb:
            self.wb.save(self.output_path)
            print(f"Report saved to: {self.output_path}")

    def update_technical_seo_tab(self, crawl_output_dir: str):
        """
        Updates Tab A: "Technical SEO"
        """
        if not self.wb: return
        
        # Get the sheet - assuming name is "Technical SEO" or similar based on description
        # If name differs, code might need adjustment. Checking for "Technical SEO"
        sheet_name = "Technical SEO"
        if sheet_name not in self.wb.sheetnames:
             # Try to find it or create it
             if "Technical" in self.wb.sheetnames:
                 sheet_name = "Technical"
             else:
                 print(f"Warning: Sheet '{sheet_name}' not found. Creating it.")
                 self.wb.create_sheet(sheet_name)
        
        ws = self.wb[sheet_name]
        
        # Load CSVs
        files = {
            "4xx": os.path.join(crawl_output_dir, "response_codes_client_error_4xx.csv"),
            "missing_alt": os.path.join(crawl_output_dir, "images_missing_alt_text.csv"),
            # Add others if needed for other metrics
        }
        
        counts = {}
        for key, path in files.items():
            if os.path.exists(path):
                try:
                    df = pd.read_csv(path)
                    # Screaming Frog CSVs often have a header row 2 (index 1) or 1 (index 0). 
                    # Assuming standard export.
                    counts[key] = len(df)
                except Exception as e:
                    print(f"Error reading {path}: {e}")
                    counts[key] = 0
            else:
                counts[key] = 0
        
        # Logic: "Count rows -> Write count to 'Occurrences' column"
        # We need to find the "Occurrences" column and the row for "Broken Links" / "Missing Alt Text"
        # This requires knowing the exact cell positions or searching for labels.
        # Implementation strategy: Search for labels in column A/B.
        
        labels_map = {
            "Broken Links": counts.get("4xx", 0),
            "Missing Alt Text": counts.get("missing_alt", 0)
        }
        
        # Naive search in first 50 rows, 10 cols
        updated = False
        for row in ws.iter_rows(min_row=1, max_row=50, min_col=1, max_col=10):
            for cell in row:
                if cell.value and isinstance(cell.value, str):
                    val = cell.value.strip()
                    if val in labels_map:
                        # Assume "Occurrences" is in the next column or specific offset?
                        # Often templates have: Metric | Occurrences | ...
                        # Let's look for a number or empty cell in the next column
                        target_cell = ws.cell(row=cell.row, column=cell.column + 1) 
                        # Or verify header. For now, put it in next col
                        target_cell.value = labels_map[val]
                        updated = True
                        
                        # Update "Date Discovered" if present (maybe +2 cols?)
                        # Just an example update
                        
        if not updated:
            print("Warning: Could not find 'Broken Links' or 'Missing Alt Text' labels in Technical SEO tab.")


    def create_detailed_audit_tab(self, crawl_output_dir: str):
        """
        Creates Tab B: "Detailed Audit Logs"
        """
        if not self.wb: return
        
        sheet_name = "Detailed Audit Logs"
        if sheet_name in self.wb.sheetnames:
            ws = self.wb[sheet_name]
            # Clear existing?
            self.wb.remove(ws)
            ws = self.wb.create_sheet(sheet_name)
        else:
            ws = self.wb.create_sheet(sheet_name)
            
        # Headers
        headers = ["Issue Type", "Page URL", "Element/Details", "Suggested Fix"]
        ws.append(headers)
        
        # Style headers
        for cell in ws[1]:
            cell.font = Font(bold=True)
            
        # Process 404s
        path_4xx = os.path.join(crawl_output_dir, "response_codes_client_error_(4xx).csv")
        if os.path.exists(path_4xx):
            try:
                df = pd.read_csv(path_4xx)
                for _, row in df.iterrows():
                    destination = row.get('Address', '')
                    source = row.get('Source', 'See Inlinks Report') 
                    ws.append(["404 Error", source, f"Linked to: {destination}", "Update link or remove"])
            except Exception as e:
                print(f"Error processing 4xx csv: {e}")

        # Process 3xx Redirects
        path_3xx = os.path.join(crawl_output_dir, "response_codes_redirection_(3xx).csv")
        if os.path.exists(path_3xx):
            try:
                df = pd.read_csv(path_3xx)
                for _, row in df.iterrows():
                    source = row.get('Address', '')
                    dest = row.get('Redirect URI', '')
                    ws.append(["Redirect (3xx)", source, f"Redirects to: {dest}", "Check if permanent/necessary"])
            except Exception as e:
                print(f"Error processing 3xx csv: {e}")

        # Process Missing Alt
        path_alt = os.path.join(crawl_output_dir, "images_missing_alt_text.csv")
        if os.path.exists(path_alt):
            try:
                df = pd.read_csv(path_alt)
                for _, row in df.iterrows():
                    source = row.get('Source', row.get('Address', '')) # Page URL
                    image = row.get('Address', '') # Image URL often
                    ws.append(["Missing Alt", source, f"Image: {image}", "Add descriptive alt text"])
            except Exception as e:
                print(f"Error processing missing alt csv: {e}")
        
        # Process Missing Alt Attribute
        path_alt_attr = os.path.join(crawl_output_dir, "images_missing_alt_attribute.csv")
        if os.path.exists(path_alt_attr):
            try:
                df = pd.read_csv(path_alt_attr)
                for _, row in df.iterrows():
                    source = row.get('Source', row.get('Address', ''))
                    image = row.get('Address', '')
                    ws.append(["Missing Alt Attribute", source, f"Image: {image}", "Add alt attribute"])
            except Exception as e:
                print(f"Error processing missing alt attr csv: {e}")

        # Process Missing H1
        path_h1 = os.path.join(crawl_output_dir, "h1_missing.csv")
        if os.path.exists(path_h1):
            try:
                df = pd.read_csv(path_h1)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    ws.append(["Missing H1", address, "", "Add H1 heading"])
            except Exception as e:
                print(f"Error processing missing h1 csv: {e}")

        # Process Multiple H1
        path_h1_multi = os.path.join(crawl_output_dir, "h1_multiple.csv")
        if os.path.exists(path_h1_multi):
            try:
                df = pd.read_csv(path_h1_multi)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    ws.append(["Multiple H1", address, "", "Use only one H1 per page"])
            except Exception as e:
                print(f"Error processing multiple h1 csv: {e}")
                
        # Process Multiple H2
        path_h2_multi = os.path.join(crawl_output_dir, "h2_multiple.csv")
        if os.path.exists(path_h2_multi):
            try:
                df = pd.read_csv(path_h2_multi)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    ws.append(["Multiple H2", address, "", "Review H2 hierarchy"])
            except Exception as e:
                print(f"Error processing multiple h2 csv: {e}")

        # Process Missing Page Titles
        path_titles = os.path.join(crawl_output_dir, "page_titles_missing.csv")
        if os.path.exists(path_titles):
            try:
                df = pd.read_csv(path_titles)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    ws.append(["Missing Page Title", address, "", "Add unique page title"])
            except Exception as e:
                print(f"Error processing missing titles csv: {e}")
                
        # Process Short Page Titles
        path_short_titles = os.path.join(crawl_output_dir, "page_titles_below_30_characters.csv")
        if os.path.exists(path_short_titles):
            try:
                df = pd.read_csv(path_short_titles)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    title = row.get('Title 1', '')
                    ws.append(["Short Page Title", address, f"Title: {title}", "Expand title (30-60 chars)"])
            except Exception as e:
                print(f"Error processing short titles csv: {e}")

        # Process Missing Meta Descriptions
        path_meta = os.path.join(crawl_output_dir, "meta_description_missing.csv")
        if os.path.exists(path_meta):
            try:
                df = pd.read_csv(path_meta)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    ws.append(["Missing Meta Description", address, "", "Add meta description (150-160 chars)"])
            except Exception as e:
                print(f"Error processing missing meta desc csv: {e}")
                
        # Process Missing Canonicals
        path_canon = os.path.join(crawl_output_dir, "canonicals_missing.csv")
        if os.path.exists(path_canon):
            try:
                df = pd.read_csv(path_canon)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    ws.append(["Missing Canonical", address, "", "Add self-referencing canonical"])
            except Exception as e:
                print(f"Error processing missing canonicals csv: {e}")

        # Process Security Headers
        security_files = {
            "Missing HSTS": "security_missing_hsts.csv",
            "Missing X-Frame-Options": "security_missing_x-frame-options_header.csv",
            "Missing X-Content-Type-Options": "security_missing_x-content-type-options_header.csv",
            "Missing Referrer-Policy": "security_missing_secure_referrer-policy_header.csv",
            "Missing CSP": "security_missing_content-security-policy_header.csv"
        }
        for issue, filename in security_files.items():
            path = os.path.join(crawl_output_dir, filename)
            if os.path.exists(path):
                try:
                    df = pd.read_csv(path)
                    for _, row in df.iterrows():
                        address = row.get('Address', '')
                        ws.append([issue, address, "", "Add security header"])
                except Exception as e:
                    print(f"Error processing {filename}: {e}")

        # Process URL Parameters
        path_params = os.path.join(crawl_output_dir, "url_parameters.csv")
        if os.path.exists(path_params):
             try:
                df = pd.read_csv(path_params)
                for _, row in df.iterrows():
                    address = row.get('Address', '')
                    ws.append(["URL Parameters", address, "", "Check for duplicate content"])
             except Exception as e:
                print(f"Error processing url params csv: {e}")

        # Process External Links (Nofollow check - simplistic)
        path_ext = os.path.join(crawl_output_dir, "links_external.csv")
        if os.path.exists(path_ext):
             try:
                df = pd.read_csv(path_ext)
                # Check for nofollow in 'Follow' column? usually true/false or 'Follow'/'Nofollow'
                # Or 'Link Type'
                if 'Follow' in df.columns:
                    nofollows = df[df['Follow'] == False] # or 'false' string
                    if nofollows.empty and df['Follow'].dtype == object:
                         nofollows = df[df['Follow'].astype(str).str.lower() == 'false']
                    
                    for _, row in nofollows.iterrows():
                         source = row.get('Source', '')
                         dest = row.get('Destination', row.get('Address', ''))
                         ws.append(["External Nofollow", source, f"Link to: {dest}", "Verify nofollow is intended"])
             except Exception as e:
                print(f"Error processing external links csv: {e}")


    def update_onpage_recommendations(self, recommendations: list):
        """
        Updates Tab C: "On-Page Recommendations"
        recommendations: list of dicts {url, keyword, original_content, proposed_content}
        """
        if not self.wb: return
        sheet_name = "On-Page Recommendations"
        if sheet_name not in self.wb.sheetnames:
             self.wb.create_sheet(sheet_name)
        ws = self.wb[sheet_name]
        
        # Block format implementation
        # Row 1: Web Page: [URL]
        # Row 2: Targeted Keyword: [Kw]
        # Row 3: Original: [Text]
        # Row 4: Proposed: [Text]
        # Row 5: Empty
        
        current_row = 1
        # Find first empty row if appending? Or clear?
        # Let's append or start fresh if empty
        if ws.max_row > 1:
            current_row = ws.max_row + 2
            
        for rec in recommendations:
            ws.cell(row=current_row, column=1, value="Web Page:")
            ws.cell(row=current_row, column=2, value=rec.get('url', ''))
            
            ws.cell(row=current_row+1, column=1, value="Targeted Keyword:")
            ws.cell(row=current_row+1, column=2, value=rec.get('keyword', ''))
            
            ws.cell(row=current_row+2, column=1, value="Original Copy:")
            ws.cell(row=current_row+2, column=2, value=rec.get('original_content', ''))
            
            ws.cell(row=current_row+3, column=1, value="Proposed Copy:")
            ws.cell(row=current_row+3, column=2, value=rec.get('proposed_content', ''))
            
            # Simple styling
            for r in range(current_row, current_row+4):
                ws.cell(row=r, column=1).font = Font(bold=True)
                ws.cell(row=r, column=2).alignment = Alignment(wrap_text=True)
            
            current_row += 5

    def update_metadata_tab(self, metadata_list: list):
        """
        Updates Tab D: "Title Tags" & "Meta Descriptions" (or combined)
        metadata_list: list of dicts {url, keywords, current_title, proposed_title, current_desc, proposed_desc}
        """
        if not self.wb: return
        
        # Looking for a sheet regarding Title Tags.
        sheet_name = "Title Tags" # or Meta Descriptions?
        # The prompt says Tab D: "Title Tags" & "Meta Descriptions". Might be two tabs or one.
        # Let's assume one tab "Metadata" or specific existing tabs.
        
        # If "Title Tags" exists, use it.
        if "Title Tags" in self.wb.sheetnames:
            ws = self.wb["Title Tags"]
            # Append to end
            start_row = ws.max_row + 1
            for item in metadata_list:
                # Mapping columns: URL | Keywords | Current | Proposed | Length
                # Assume Col A=URL, B=Keywords, C=Current, D=Proposed
                ws.append([
                    item.get('url'),
                    item.get('keywords'),
                    item.get('current_title'),
                    item.get('proposed_title'),
                    len(item.get('proposed_title', ''))
                ])
        else:
            # Create one
            ws = self.wb.create_sheet("Metadata Optimization")
            ws.append(["URL", "Keywords", "Current Title", "Proposed Title", "Length", "Current Desc", "Proposed Desc", "Length"])
            for item in metadata_list:
                ws.append([
                    item.get('url'),
                    item.get('keywords'),
                    item.get('current_title'),
                    item.get('proposed_title'),
                    len(item.get('proposed_title', '')),
                    item.get('current_desc'),
                    item.get('proposed_desc'),
                    len(item.get('proposed_desc', ''))
                ])


