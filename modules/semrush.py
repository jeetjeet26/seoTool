import re
import time

import requests

from config import Config

class SemrushClient:
    BASE_URL = "https://api.semrush.com/"
    BACKLINKS_OVERVIEW_URL = "https://api.semrush.com/analytics/v1/"

    def __init__(self):
        self.api_key = Config.SEMRUSH_API_KEY
        self.diagnostics: list[str] = []
        if not self.api_key:
            print("Warning: SEMRUSH_API_KEY is not set.")

    def _diagnostic(self, message: str) -> None:
        if not hasattr(self, "diagnostics"):
            self.diagnostics = []
        sanitized = re.sub(r"([?&]key=)[^&\s]+", r"\1[REDACTED]", message)
        if self.api_key:
            sanitized = sanitized.replace(self.api_key, "[REDACTED]")
        self.diagnostics.append(sanitized[:500])

    def consume_diagnostics(self) -> list[str]:
        diagnostics = list(getattr(self, "diagnostics", []))
        self.diagnostics = []
        return diagnostics

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
            response = requests.get(self.BASE_URL, params=params, timeout=60)
            response.raise_for_status()
            
            # Response is usually CSV-like text. 
            # Header: Domain;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords;Adwords Traffic;Adwords Cost
            # Data: example.com;123;456;...
            
            response_text = response.text.strip()
            if response_text.startswith("ERROR"):
                self._diagnostic(f"domain_rank: {response_text}")
                return {}
            lines = response_text.split('\n')
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
            self._diagnostic(f"domain_rank request failed: {e}")
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

    # ------------------------------------------------------------------
    # Discovery reports used by keyword strategy and technical correlation
    # ------------------------------------------------------------------

    def _report_rows(self, params: dict, base_url: str | None = None) -> list[dict]:
        """Run a Semrush analytics report and return rows keyed by header name."""
        if not self.api_key:
            return []
        request_params = {"key": self.api_key, "database": "us", **params}
        try:
            response = requests.get(
                base_url or self.BASE_URL,
                params=request_params,
                timeout=60,
            )
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching Semrush report {params.get('type')}: {e}")
            self._diagnostic(f"{params.get('type')} request failed: {e}")
            return []

        text = response.text.strip()
        if text.startswith("ERROR 50"):
            return []
        if text.startswith("ERROR"):
            self._diagnostic(f"{params.get('type')}: {text}")
            return []
        if not text:
            return []
        lines = text.split("\n")
        if len(lines) < 2:
            return []
        header = [column.strip() for column in lines[0].split(";")]
        rows = []
        for line in lines[1:]:
            values = line.split(";")
            if len(values) != len(header):
                continue
            rows.append(dict(zip(header, (value.strip() for value in values))))
        return rows

    def get_organic_positions(self, domain: str, limit: int = 100) -> list[dict]:
        """Keywords the domain currently ranks for, with per-URL detail."""
        rows = self._report_rows(
            {
                "type": "domain_organic",
                "domain": domain,
                "display_limit": limit,
                "export_columns": "Ph,Po,Nq,Cp,Co,Kd,Ur,Tr",
            }
        )
        return [
            {
                "keyword": row.get("Keyword", ""),
                "position": _to_int(row.get("Position")),
                "volume": _to_int(row.get("Search Volume")),
                "cpc": _to_float(row.get("CPC")),
                "competition": _to_float(row.get("Competition")),
                "difficulty": _keyword_difficulty(row),
                "landing_page": row.get("Url", ""),
                "traffic_percent": _to_float(row.get("Traffic (%)")),
            }
            for row in rows
            if row.get("Keyword")
        ]

    def get_competitors(self, domain: str, limit: int = 10) -> list[dict]:
        """Organic competitors ordered by competition level."""
        rows = self._report_rows(
            {
                "type": "domain_organic_organic",
                "domain": domain,
                "display_limit": limit,
                "export_columns": "Dn,Cr,Np,Or,Ot",
            }
        )
        return [
            {
                "domain": row.get("Domain", ""),
                "competition_level": _to_float(row.get("Competitor Relevance")),
                "common_keywords": _to_int(row.get("Common Keywords")),
                "organic_keywords": _to_int(row.get("Organic Keywords")),
                "organic_traffic": _to_int(row.get("Organic Traffic")),
            }
            for row in rows
            if row.get("Domain")
        ]

    def get_backlinks_overview(self, domain: str) -> dict:
        """Backlink authority totals for the root domain."""
        rows = self._report_rows(
            {
                "type": "backlinks_overview",
                "target": domain,
                "target_type": "root_domain",
                "export_columns": "ascore,total,domains_num,urls_num,ips_num",
            },
            base_url=self.BACKLINKS_OVERVIEW_URL,
        )
        if not rows:
            return {}
        row = rows[0]
        return {
            "authority_score": _to_int(row.get("ascore")),
            "total_backlinks": _to_int(row.get("total")),
            "referring_domains": _to_int(row.get("domains_num")),
            "referring_urls": _to_int(row.get("urls_num")),
            "referring_ips": _to_int(row.get("ips_num")),
        }

    def get_keyword_ideas(self, phrase: str, limit: int = 40) -> list[dict]:
        """Related keyword ideas for a seed phrase (phrase_related report)."""
        rows = self._report_rows(
            {
                "type": "phrase_related",
                "phrase": phrase,
                "display_limit": limit,
                "export_columns": "Ph,Nq,Cp,Co,Kd",
            }
        )
        return [
            {
                "keyword": row.get("Keyword", ""),
                "volume": _to_int(row.get("Search Volume")),
                "cpc": _to_float(row.get("CPC")),
                "competition": _to_float(row.get("Competition")),
                "difficulty": _keyword_difficulty(row),
            }
            for row in rows
            if row.get("Keyword")
        ]


def _to_int(value) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return 0


def _to_float(value) -> float:
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return 0.0


def _keyword_difficulty(row: dict) -> float:
    """Normalize Semrush's report-specific keyword difficulty headers."""
    return _to_float(
        row.get("Keyword Difficulty")
        or row.get("Keyword Difficulty Index")
    )


if __name__ == "__main__":
    # Test
    s = SemrushClient()
    # print(s.get_domain_overview("example.com"))
    # print(s.get_keyword_data(["apartments in dallas"]))
    pass

