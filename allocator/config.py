"""
Configuration Management for MRO Resource Allocator
====================================================
Loads configuration from environment variables.
"""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


@dataclass
class DatabaseConfig:
    """Database connection configuration."""
    url: str

    @classmethod
    def from_env(cls) -> "DatabaseConfig":
        url = os.getenv("DATABASE_URL")
        if not url:
            raise ValueError("DATABASE_URL environment variable is required")
        return cls(url=url)


@dataclass
class AzureOpenAIConfig:
    """Azure OpenAI configuration."""
    api_key: str
    endpoint: str
    api_version: str
    model: str

    @classmethod
    def from_env(cls) -> "AzureOpenAIConfig":
        api_key = os.getenv("AZURE_OPENAI_API_KEY")
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
        model = os.getenv("AZURE_OPENAI_MODEL", "gpt-4o")

        if not api_key:
            raise ValueError("AZURE_OPENAI_API_KEY environment variable is required")
        if not endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is required")

        return cls(
            api_key=api_key,
            endpoint=endpoint,
            api_version=api_version,
            model=model
        )


@dataclass
class AllocationConfig:
    """Allocation algorithm configuration."""
    similarity_threshold: float
    max_retries: int

    @classmethod
    def from_env(cls) -> "AllocationConfig":
        similarity_threshold = float(os.getenv("SIMILARITY_THRESHOLD", "0.90"))
        max_retries = int(os.getenv("MAX_RETRIES", "2"))

        return cls(
            similarity_threshold=similarity_threshold,
            max_retries=max_retries
        )


@dataclass
class Config:
    """Main configuration container."""
    database: DatabaseConfig
    azure_openai: AzureOpenAIConfig
    allocation: AllocationConfig

    @classmethod
    def from_env(cls) -> "Config":
        """Load all configuration from environment variables."""
        return cls(
            database=DatabaseConfig.from_env(),
            azure_openai=AzureOpenAIConfig.from_env(),
            allocation=AllocationConfig.from_env()
        )


# Singleton config instance
_config: Config | None = None


def get_config() -> Config:
    """Get the configuration singleton."""
    global _config
    if _config is None:
        _config = Config.from_env()
    return _config
