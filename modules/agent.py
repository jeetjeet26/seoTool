import anthropic
from config import Config
import json

class SEOAgent:
    def __init__(self):
        self.api_key = Config.ANTHROPIC_API_KEY
        if not self.api_key:
            print("Warning: ANTHROPIC_API_KEY is not set.")
            self.client = None
        else:
            self.client = anthropic.Anthropic(api_key=self.api_key)
        
        self.model = "claude-sonnet-4-5-20250929" 

    def _get_completion(self, system_prompt: str, user_prompt: str) -> str:
        if not self.client:
            return "Error: Anthropic API key not configured."
        
        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=1000,
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

    def optimize_metadata(self, page_data: dict):
        """
        Generates optimized Title Tag and Meta Description.
        page_data should contain: 'url', 'current_title', 'keywords' (list)
        """
        url = page_data.get('url', '')
        keywords = ", ".join(page_data.get('keywords', []))
        
        system_prompt = "You are an expert Real Estate SEO Copywriter. Your tone is luxury, welcoming, and professional."
        
        user_prompt = f"""
        Please write a new Title Tag (max 60 chars) and Meta Description (max 160 chars) for the following page.
        
        Page URL: {url}
        Target Keywords: {keywords}
        
        Ensure the copy mentions the location if possible based on the keywords or URL.
        
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
        
        system_prompt = "You are an expert Real Estate SEO Copywriter. Your tone is luxury, welcoming, and professional."
        
        user_prompt = f"""
        Rewrite the following H1 and Introductory Paragraph to better target the keyword: "{keyword}".
        
        Current H1: {current_h1}
        Current Intro: {current_content}
        
        Keep HTML formatting tags if present in the original text.
        
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

if __name__ == "__main__":
    # Test
    # agent = SEOAgent()
    # print(agent.optimize_metadata({
    #     "url": "https://example.com/apartments-dallas",
    #     "keywords": ["luxury apartments dallas", "dallas rentals"]
    # }))
    pass

