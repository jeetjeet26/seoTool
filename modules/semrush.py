import requests
from config import Config
import time

class SemrushClient:
    BASE_URL = "https://api.semrush.com/"

    def __init__(self):
        self.api_key = Config.SEMRUSH_API_KEY
        if not self.api_key:
            print("Warning: SEMRUSH_API_KEY is not set.")

    def get_domain_overview(self, domain: str):
        """
        Fetches domain overview data using the domain_rank endpoint.
        Returns a dictionary with organic traffic, keywords, etc.
        """
        if not self.api_key:
            return {}

        params = {
            "type": "domain_rank",
            "key": self.api_key,
            "domain": domain,
            "export_columns": "Dn,Or,Ot,Oc,Ad,At,Ac", # Domain, Organic Keywords, Organic Traffic, Organic Cost, Adwords Keywords...
            "database": "us" # Defaulting to US
        }

        try:
            response = requests.get(self.BASE_URL, params=params)
            response.raise_for_status()
            
            # Response is usually CSV-like text. 
            # Header: Domain;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords;Adwords Traffic;Adwords Cost
            # Data: example.com;123;456;...
            
            lines = response.text.strip().split('\n')
            if len(lines) < 2:
                print("Semrush: No data returned for domain overview.")
                return {}
            
            header = lines[0].split(';')
            data = lines[1].split(';')
            
            result = {
                "domain": data[0],
                "organic_keywords": int(data[1]) if len(data) > 1 else 0,
                "organic_traffic": int(data[2]) if len(data) > 2 else 0,
                "organic_cost": float(data[3]) if len(data) > 3 else 0.0,
            }
            return result

        except requests.exceptions.RequestException as e:
            print(f"Error fetching Semrush domain overview: {e}")
            return {}

    def get_keyword_data(self, keywords_list: list):
        """
        Fetches search volume and KD% for a list of keywords.
        Using 'phrase_this' or similar batch endpoint if available, 
        but strictly following 'keyword_overview' request style for single/batch.
        
        Note: 'phrase_this' gets data for a single keyword. 
        For batch, we might need 'phrase_batch' or iterate. 
        The prompt says 'keyword_overview', often implying the broad report.
        We'll use 'phrase_this' for specific metrics per keyword for simplicity 
        unless we can batch.
        """
        if not self.api_key or not keywords_list:
            return {}

        results = {}
        
        # Semrush API limitations might require batching or single calls.
        # Standard 'phrase_this' is one by one.
        
        for kw in keywords_list:
            params = {
                "type": "phrase_this",
                "key": self.api_key,
                "phrase": kw,
                "export_columns": "Ph,Nq,Kd", # Phrase, Search Volume, Keyword Difficulty
                "database": "us"
            }
            
            try:
                response = requests.get(self.BASE_URL, params=params)
                response.raise_for_status()
                
                lines = response.text.strip().split('\n')
                if len(lines) >= 2:
                    data = lines[1].split(';')
                    # data[0] = phrase, data[1] = volume, data[2] = kd
                    results[kw] = {
                        "volume": int(data[1]) if len(data) > 1 and data[1] else 0,
                        "kd": float(data[2]) if len(data) > 2 and data[2] else 0.0
                    }
                else:
                    results[kw] = {"volume": 0, "kd": 0.0}
                    
                # Be nice to the API
                time.sleep(0.1) 

            except requests.exceptions.RequestException as e:
                print(f"Error fetching data for keyword '{kw}': {e}")
                results[kw] = {"volume": 0, "kd": 0.0}
        
        return results

if __name__ == "__main__":
    # Test
    s = SemrushClient()
    # print(s.get_domain_overview("example.com"))
    # print(s.get_keyword_data(["apartments in dallas"]))
    pass

