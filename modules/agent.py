import anthropic
from config import Config
import json
from typing import List, Dict, Optional

class SEOAgent:
    # Fair Housing Act compliance guidelines for all content generation
    FAIR_HOUSING_GUIDELINES = """
CRITICAL - FAIR HOUSING ACT COMPLIANCE:
All generated content MUST comply with the Fair Housing Act. You must NOT include any language that:
1. References or implies preferences based on race, color, national origin, religion, sex, familial status, or disability
2. Uses exclusionary terms like "perfect for singles," "ideal for couples," "no children," "adults only," "Christian community," "walking distance to church"
3. Implies age restrictions (except for legally designated senior housing 55+/62+)
4. Describes neighborhoods in ways that suggest racial/ethnic composition
5. Uses terms like "exclusive," "private," or "prestigious" in ways that could imply discrimination
6. References proximity to religious institutions, country clubs, or private schools as selling points
7. Uses phrases like "family-friendly" (implies discrimination against non-families) - use "welcoming community" instead
8. Mentions "master bedroom" - use "primary bedroom" instead

SAFE LANGUAGE EXAMPLES:
- "Welcoming community" instead of "family-friendly"
- "Close to schools" (factual) but not "great for families with kids"
- "Spacious floor plans" instead of "perfect for large families"
- "Pet-friendly" is acceptable
- Focus on amenities, location features, and property characteristics
"""

    def __init__(self):
        self.api_key = Config.ANTHROPIC_API_KEY
        if not self.api_key:
            print("Warning: ANTHROPIC_API_KEY is not set.")
            self.client = None
        else:
            self.client = anthropic.Anthropic(api_key=self.api_key)
        
        self.model = "claude-sonnet-4-5-20250929"
        self.batch_size = 50  # Max items per batch API call

    def _get_completion(self, system_prompt: str, user_prompt: str, max_tokens: int = 1000) -> str:
        if not self.client:
            return "Error: Anthropic API key not configured."
        
        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                temperature=0.7,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": user_prompt}
                ]
            )
            return message.content[0].text
        except Exception as e:
            print(f"Error calling Anthropic API: {e}")
            return ""
    
    def _batch_process(self, items: List[Dict], process_func, batch_size: int = None) -> List[Dict]:
        """
        Process items in batches to avoid overwhelming the API.
        Returns list of items with suggestions added.
        """
        if batch_size is None:
            batch_size = self.batch_size
            
        results = []
        total = len(items)
        
        for i in range(0, total, batch_size):
            batch = items[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (total + batch_size - 1) // batch_size
            print(f"  Processing batch {batch_num}/{total_batches} ({len(batch)} items)...")
            
            batch_results = process_func(batch)
            results.extend(batch_results)
            
        return results

    def optimize_metadata(self, page_data: dict):
        """
        Generates optimized Title Tag and Meta Description.
        page_data should contain: 'url', 'current_title', 'keywords' (list)
        """
        url = page_data.get('url', '')
        keywords = ", ".join(page_data.get('keywords', []))
        
        system_prompt = f"""You are an expert Real Estate SEO Copywriter. Your tone is luxury, welcoming, and professional.
{self.FAIR_HOUSING_GUIDELINES}"""
        
        user_prompt = f"""
        Please write a new Title Tag (max 60 chars) and Meta Description (max 160 chars) for the following page.
        
        Page URL: {url}
        Target Keywords: {keywords}
        
        Ensure the copy mentions the location if possible based on the keywords or URL.
        Ensure all language is Fair Housing Act compliant.
        
        Return the result in the following JSON format only:
        {{
            "title": "Your generated title",
            "meta_description": "Your generated meta description"
        }}
        """
        
        response = self._get_completion(system_prompt, user_prompt)
        
        # clean up potential markdown code blocks
        response = response.replace("```json", "").replace("```", "").strip()
        
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Fallback if JSON parsing fails
            print(f"Failed to parse JSON from agent response: {response}")
            return {"title": "", "meta_description": ""}

    def optimize_onpage(self, page_data: dict):
        """
        Rewrites H1 and Introductory Paragraph.
        page_data should contain: 'url', 'current_h1', 'current_content', 'target_keyword'
        """
        current_h1 = page_data.get('current_h1', '')
        current_content = page_data.get('current_content', '') # or intro paragraph
        keyword = page_data.get('target_keyword', '')
        
        system_prompt = f"""You are an expert Real Estate SEO Copywriter. Your tone is luxury, welcoming, and professional.
{self.FAIR_HOUSING_GUIDELINES}"""
        
        user_prompt = f"""
        Rewrite the following H1 and Introductory Paragraph to better target the keyword: "{keyword}".
        
        Current H1: {current_h1}
        Current Intro: {current_content}
        
        Keep HTML formatting tags if present in the original text.
        Ensure all language is Fair Housing Act compliant.
        
        Return the result in the following JSON format only:
        {{
            "h1": "New H1",
            "content": "New Intro Paragraph"
        }}
        """
        
        response = self._get_completion(system_prompt, user_prompt)
        
        # clean up
        response = response.replace("```json", "").replace("```", "").strip()
        
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            print(f"Failed to parse JSON from agent response: {response}")
            return {"h1": "", "content": ""}

    # ============================================================
    # BATCH AUDIT SUGGESTION METHODS
    # ============================================================

    def generate_alt_text_batch(self, items: List[Dict]) -> List[Dict]:
        """
        Generate alt text suggestions for a batch of images.
        Each item should have: 'image_url', 'page_url'
        Returns items with 'suggested_fix' added.
        """
        if not items:
            return items
            
        def process_batch(batch: List[Dict]) -> List[Dict]:
            # Build batch prompt
            items_text = "\n".join([
                f"{i+1}. Image: {item.get('image_url', 'unknown')} | Page: {item.get('page_url', 'unknown')}"
                for i, item in enumerate(batch)
            ])
            
            system_prompt = f"""You are an expert SEO specialist for real estate websites. 
Your task is to generate descriptive, SEO-friendly alt text for images based on their filename and the page they appear on.
Alt text should be concise (under 125 characters), descriptive, and include relevant keywords when appropriate.
{self.FAIR_HOUSING_GUIDELINES}"""
            
            user_prompt = f"""Generate alt text for each of the following images. 
Analyze the image filename and page URL to infer what the image likely shows.
Ensure all alt text is Fair Housing Act compliant - focus on describing the physical space/amenity, not who might use it.

Images:
{items_text}

Return ONLY a JSON array with objects containing "index" (1-based) and "alt_text" for each image.
Example: [{{"index": 1, "alt_text": "Spacious living room with modern furnishings"}}]
"""
            
            response = self._get_completion(system_prompt, user_prompt, max_tokens=4000)
            response = response.replace("```json", "").replace("```", "").strip()
            
            try:
                suggestions = json.loads(response)
                suggestion_map = {s['index']: s['alt_text'] for s in suggestions}
                
                for i, item in enumerate(batch):
                    item['suggested_fix'] = suggestion_map.get(i + 1, "Add descriptive alt text")
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Failed to parse alt text suggestions: {e}")
                for item in batch:
                    item['suggested_fix'] = "Add descriptive alt text"
                    
            return batch
        
        return self._batch_process(items, process_batch)

    def generate_title_suggestions_batch(self, items: List[Dict]) -> List[Dict]:
        """
        Generate title tag suggestions for pages with missing/short titles.
        Each item should have: 'page_url', 'current_title' (optional)
        Returns items with 'suggested_fix' added.
        """
        if not items:
            return items
            
        def process_batch(batch: List[Dict]) -> List[Dict]:
            items_text = "\n".join([
                f"{i+1}. URL: {item.get('page_url', 'unknown')} | Current: {item.get('current_title', 'None')}"
                for i, item in enumerate(batch)
            ])
            
            system_prompt = f"""You are an expert SEO specialist for real estate websites.
Your task is to generate optimized title tags (50-60 characters) that are compelling and keyword-rich.
Infer the page topic from the URL structure.
{self.FAIR_HOUSING_GUIDELINES}"""
            
            user_prompt = f"""Generate SEO-optimized title tags for each of the following pages.
Analyze the URL to understand the page content and create appropriate titles.
Ensure all titles are Fair Housing Act compliant.

Pages:
{items_text}

Return ONLY a JSON array with objects containing "index" (1-based) and "title" for each page.
Example: [{{"index": 1, "title": "Luxury 2-Bedroom Apartments in Dallas | Property Name"}}]
"""
            
            response = self._get_completion(system_prompt, user_prompt, max_tokens=4000)
            response = response.replace("```json", "").replace("```", "").strip()
            
            try:
                suggestions = json.loads(response)
                suggestion_map = {s['index']: s['title'] for s in suggestions}
                
                for i, item in enumerate(batch):
                    item['suggested_fix'] = f"Suggested: {suggestion_map.get(i + 1, 'Add unique page title (50-60 chars)')}"
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Failed to parse title suggestions: {e}")
                for item in batch:
                    item['suggested_fix'] = "Add unique page title (50-60 chars)"
                    
            return batch
        
        return self._batch_process(items, process_batch)

    def generate_meta_description_batch(self, items: List[Dict]) -> List[Dict]:
        """
        Generate meta description suggestions for pages with missing descriptions.
        Each item should have: 'page_url'
        Returns items with 'suggested_fix' added.
        """
        if not items:
            return items
            
        def process_batch(batch: List[Dict]) -> List[Dict]:
            items_text = "\n".join([
                f"{i+1}. URL: {item.get('page_url', 'unknown')}"
                for i, item in enumerate(batch)
            ])
            
            system_prompt = f"""You are an expert SEO specialist for real estate websites.
Your task is to generate compelling meta descriptions (150-160 characters) that encourage clicks.
Infer the page topic from the URL structure. Include a call-to-action when appropriate.
{self.FAIR_HOUSING_GUIDELINES}"""
            
            user_prompt = f"""Generate SEO-optimized meta descriptions for each of the following pages.
Analyze the URL to understand the page content.
Ensure all descriptions are Fair Housing Act compliant.

Pages:
{items_text}

Return ONLY a JSON array with objects containing "index" (1-based) and "description" for each page.
Example: [{{"index": 1, "description": "Discover spacious 2-bedroom apartments in Dallas. Modern amenities, pet-friendly community. Schedule your tour today!"}}]
"""
            
            response = self._get_completion(system_prompt, user_prompt, max_tokens=4000)
            response = response.replace("```json", "").replace("```", "").strip()
            
            try:
                suggestions = json.loads(response)
                suggestion_map = {s['index']: s['description'] for s in suggestions}
                
                for i, item in enumerate(batch):
                    item['suggested_fix'] = f"Suggested: {suggestion_map.get(i + 1, 'Add meta description (150-160 chars)')}"
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Failed to parse meta description suggestions: {e}")
                for item in batch:
                    item['suggested_fix'] = "Add meta description (150-160 chars)"
                    
            return batch
        
        return self._batch_process(items, process_batch)

    def generate_h1_suggestions_batch(self, items: List[Dict]) -> List[Dict]:
        """
        Generate H1 suggestions for pages with missing H1s.
        Each item should have: 'page_url'
        Returns items with 'suggested_fix' added.
        """
        if not items:
            return items
            
        def process_batch(batch: List[Dict]) -> List[Dict]:
            items_text = "\n".join([
                f"{i+1}. URL: {item.get('page_url', 'unknown')}"
                for i, item in enumerate(batch)
            ])
            
            system_prompt = f"""You are an expert SEO specialist for real estate websites.
Your task is to generate compelling H1 headings that clearly describe the page content and include relevant keywords.
Infer the page topic from the URL structure. H1s should be concise but descriptive.
{self.FAIR_HOUSING_GUIDELINES}"""
            
            user_prompt = f"""Generate SEO-optimized H1 headings for each of the following pages.
Analyze the URL to understand the page content.
Ensure all H1s are Fair Housing Act compliant.

Pages:
{items_text}

Return ONLY a JSON array with objects containing "index" (1-based) and "h1" for each page.
Example: [{{"index": 1, "h1": "Luxury 2-Bedroom Apartments in Downtown Dallas"}}]
"""
            
            response = self._get_completion(system_prompt, user_prompt, max_tokens=4000)
            response = response.replace("```json", "").replace("```", "").strip()
            
            try:
                suggestions = json.loads(response)
                suggestion_map = {s['index']: s['h1'] for s in suggestions}
                
                for i, item in enumerate(batch):
                    item['suggested_fix'] = f"Suggested H1: {suggestion_map.get(i + 1, 'Add descriptive H1 heading')}"
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Failed to parse H1 suggestions: {e}")
                for item in batch:
                    item['suggested_fix'] = "Add descriptive H1 heading"
                    
            return batch
        
        return self._batch_process(items, process_batch)

    def suggest_404_fixes_batch(self, items: List[Dict], valid_urls: List[str] = None) -> List[Dict]:
        """
        Suggest fixes for 404 errors by analyzing broken URLs and suggesting likely corrections.
        Each item should have: 'broken_url', 'source_url'
        valid_urls: Optional list of valid URLs from the crawl for fuzzy matching
        Returns items with 'suggested_fix' added.
        """
        if not items:
            return items
            
        valid_urls_sample = []
        if valid_urls:
            # Limit to 100 valid URLs for context
            valid_urls_sample = valid_urls[:100]
            
        def process_batch(batch: List[Dict]) -> List[Dict]:
            items_text = "\n".join([
                f"{i+1}. Broken: {item.get('broken_url', 'unknown')} | Found on: {item.get('source_url', 'unknown')}"
                for i, item in enumerate(batch)
            ])
            
            valid_urls_text = ""
            if valid_urls_sample:
                valid_urls_text = f"\n\nValid URLs on this site (for reference):\n" + "\n".join(valid_urls_sample[:50])
            
            system_prompt = """You are an expert SEO specialist analyzing broken links on a website.
Your task is to suggest fixes for 404 errors. Consider:
1. Typos in the URL (e.g., /contact-u instead of /contact-us)
2. Outdated links that should be updated or removed
3. Missing trailing slashes or incorrect paths
4. If a valid URL list is provided, suggest the most likely correct URL"""
            
            user_prompt = f"""Analyze these broken links and suggest fixes.

Broken Links:
{items_text}
{valid_urls_text}

Return ONLY a JSON array with objects containing "index" (1-based) and "fix" (your suggestion) for each broken link.
Example: [{{"index": 1, "fix": "Likely typo. Update to /contact-us"}}]
"""
            
            response = self._get_completion(system_prompt, user_prompt, max_tokens=4000)
            response = response.replace("```json", "").replace("```", "").strip()
            
            try:
                suggestions = json.loads(response)
                suggestion_map = {s['index']: s['fix'] for s in suggestions}
                
                for i, item in enumerate(batch):
                    item['suggested_fix'] = suggestion_map.get(i + 1, "Update link or remove")
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Failed to parse 404 fix suggestions: {e}")
                for item in batch:
                    item['suggested_fix'] = "Update link or remove"
                    
            return batch
        
        return self._batch_process(items, process_batch)

    def suggest_redirect_fixes_batch(self, items: List[Dict]) -> List[Dict]:
        """
        Analyze redirects and suggest whether they should be updated.
        Each item should have: 'source_url', 'redirect_destination'
        Returns items with 'suggested_fix' added.
        """
        if not items:
            return items
            
        def process_batch(batch: List[Dict]) -> List[Dict]:
            items_text = "\n".join([
                f"{i+1}. From: {item.get('source_url', 'unknown')} -> To: {item.get('redirect_destination', 'unknown')}"
                for i, item in enumerate(batch)
            ])
            
            system_prompt = """You are an expert SEO specialist analyzing redirect chains on a website.
Your task is to evaluate redirects and suggest actions:
1. If it's a legitimate permanent redirect (e.g., HTTP to HTTPS, www to non-www), mark as OK
2. If internal links should be updated to point directly to the destination, suggest that
3. Identify potential redirect chains or loops"""
            
            user_prompt = f"""Analyze these redirects and suggest actions.

Redirects:
{items_text}

Return ONLY a JSON array with objects containing "index" (1-based) and "action" for each redirect.
Example: [{{"index": 1, "action": "Update internal links to point directly to /new-page"}}]
"""
            
            response = self._get_completion(system_prompt, user_prompt, max_tokens=4000)
            response = response.replace("```json", "").replace("```", "").strip()
            
            try:
                suggestions = json.loads(response)
                suggestion_map = {s['index']: s['action'] for s in suggestions}
                
                for i, item in enumerate(batch):
                    item['suggested_fix'] = suggestion_map.get(i + 1, "Check if redirect is necessary")
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Failed to parse redirect suggestions: {e}")
                for item in batch:
                    item['suggested_fix'] = "Check if redirect is necessary"
                    
            return batch
        
        return self._batch_process(items, process_batch)

    def suggest_canonical_fixes_batch(self, items: List[Dict]) -> List[Dict]:
        """
        Suggest canonical tag fixes for pages missing canonicals.
        Each item should have: 'page_url'
        Returns items with 'suggested_fix' added.
        """
        if not items:
            return items
            
        def process_batch(batch: List[Dict]) -> List[Dict]:
            items_text = "\n".join([
                f"{i+1}. URL: {item.get('page_url', 'unknown')}"
                for i, item in enumerate(batch)
            ])
            
            system_prompt = """You are an expert SEO specialist analyzing canonical tag issues.
Your task is to suggest the appropriate canonical URL for each page.
Consider:
1. Self-referencing canonicals (most common)
2. URL parameters that should be stripped
3. Trailing slash consistency
4. HTTP vs HTTPS, www vs non-www"""
            
            user_prompt = f"""Suggest canonical URLs for these pages that are missing canonical tags.

Pages:
{items_text}

Return ONLY a JSON array with objects containing "index" (1-based) and "canonical" (the suggested canonical URL) for each page.
Example: [{{"index": 1, "canonical": "https://example.com/floor-plans/"}}]
"""
            
            response = self._get_completion(system_prompt, user_prompt, max_tokens=4000)
            response = response.replace("```json", "").replace("```", "").strip()
            
            try:
                suggestions = json.loads(response)
                suggestion_map = {s['index']: s['canonical'] for s in suggestions}
                
                for i, item in enumerate(batch):
                    canonical = suggestion_map.get(i + 1)
                    if canonical:
                        item['suggested_fix'] = f"Add canonical: {canonical}"
                    else:
                        item['suggested_fix'] = "Add self-referencing canonical tag"
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Failed to parse canonical suggestions: {e}")
                for item in batch:
                    item['suggested_fix'] = "Add self-referencing canonical tag"
                    
            return batch
        
        return self._batch_process(items, process_batch)


if __name__ == "__main__":
    # Test
    # agent = SEOAgent()
    # print(agent.optimize_metadata({
    #     "url": "https://example.com/apartments-dallas",
    #     "keywords": ["luxury apartments dallas", "dallas rentals"]
    # }))
    pass

