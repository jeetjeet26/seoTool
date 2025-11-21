import os
from dotenv import load_dotenv
import sys

# Load environment variables from .env file
load_dotenv()

class Config:
    """
    Configuration class to manage environment variables and settings.
    """
    
    # API Keys
    SEMRUSH_API_KEY = os.getenv("SEMRUSH_API_KEY")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    
    # Paths
    # Default to a common Windows path if not set, but allow override
    # The CLI executable is often 'ScreamingFrogSEOSpiderCLI.exe' on Windows
    SCREAMING_FROG_PATH = os.getenv(
        "SCREAMING_FROG_PATH", 
        r"C:\Program Files (x86)\Screaming Frog SEO Spider\ScreamingFrogSEOSpiderCLI.exe"
    )
    
    # Validation
    @classmethod
    def validate(cls):
        """
        Validate that critical configuration is present.
        """
        missing = []
        if not cls.SEMRUSH_API_KEY:
            missing.append("SEMRUSH_API_KEY")
        if not cls.ANTHROPIC_API_KEY:
            missing.append("ANTHROPIC_API_KEY")
        
        # Check if Screaming Frog path exists
        if not os.path.exists(cls.SCREAMING_FROG_PATH):
             # Just a warning for now, as it might be in PATH
             print(f"Warning: Screaming Frog executable not found at {cls.SCREAMING_FROG_PATH}. Ensure it is installed or in your PATH.")

        if missing:
            raise ValueError(f"Missing required environment variables: {', '.join(missing)}. Please set them in a .env file.")
        
        return True

# Create a global instance or just use the class
config = Config()

