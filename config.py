from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv
import os

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str
    check_interval_minutes: int = 3
    timezone: str = "America/Chicago"
    target_day: int = 2
    target_hour_start: int = 11
    target_hour_end: int = 13

settings = Settings()