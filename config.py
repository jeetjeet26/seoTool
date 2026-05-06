import os
from dotenv import load_dotenv
import platform
import shutil

# Load environment variables from .env file
load_dotenv()

def get_default_screaming_frog_path():
    """
    Return the most common Screaming Frog CLI path for the current OS.
    """
    system = platform.system()

    if system == "Darwin":
        return "/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher"

    if system == "Windows":
        return r"C:\Program Files (x86)\Screaming Frog SEO Spider\ScreamingFrogSEOSpiderCLI.exe"

    return "screamingfrogseospider"

class Config:
    """
    Configuration class to manage environment variables and settings.
    """
    
    # API Keys
    SEMRUSH_API_KEY = os.getenv("SEMRUSH_API_KEY")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    
    # Paths
    # Prefer SCREAMING_FROG_PATH; keep SF_HEADLESS_PATH for older setup docs.
    SCREAMING_FROG_PATH = (
        os.getenv("SCREAMING_FROG_PATH")
        or os.getenv("SF_HEADLESS_PATH")
        or get_default_screaming_frog_path()
    )
    
    # Validation
    @classmethod
    def validate(cls):
        """
        Validate that critical configuration is present.
        """
        errors = []
        if not cls.SEMRUSH_API_KEY:
            errors.append("SEMRUSH_API_KEY is not set")
        if not cls.ANTHROPIC_API_KEY:
            errors.append("ANTHROPIC_API_KEY is not set")
        
        # Check if Screaming Frog path exists. A bare command name is allowed for PATH-based installs.
        is_path = "/" in cls.SCREAMING_FROG_PATH or "\\" in cls.SCREAMING_FROG_PATH
        if is_path and not os.path.exists(cls.SCREAMING_FROG_PATH):
            errors.append(f"Screaming Frog executable not found at: {cls.SCREAMING_FROG_PATH}")
        elif not is_path and not shutil.which(cls.SCREAMING_FROG_PATH):
            errors.append(f"Screaming Frog executable not found in PATH: {cls.SCREAMING_FROG_PATH}")

        if errors:
            raise ValueError(
                "Configuration errors: "
                + "; ".join(errors)
                + ". Please set the required values in a .env file."
            )
        
        return True

# Create a global instance or just use the class
config = Config()

