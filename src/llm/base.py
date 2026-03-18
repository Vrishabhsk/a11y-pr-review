"""Abstract base class for LLM clients."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, List, Optional, Any


@dataclass
class LLMResponse:
    """Structured response from an LLM."""
    content: str
    model: str
    usage: Optional[Dict[str, int]] = None
    raw_response: Optional[Any] = None

    # Parsed structured data (if LLM returned JSON)
    structured_data: Optional[List[Dict]] = None


class LLMClient(ABC):
    """Abstract interface for LLM clients used in accessibility review."""

    @abstractmethod
    def analyze_diff(
        self,
        diff_content: str,
        system_prompt: str,
        user_prompt: str,
        json_schema: Optional[Dict] = None
    ) -> LLMResponse:
        """
        Analyze a diff for accessibility issues.

        Args:
            diff_content: The unified diff content to analyze
            system_prompt: System prompt defining the analysis context
            user_prompt: User prompt with specific instructions
            json_schema: Optional JSON schema for structured output

        Returns:
            LLMResponse with analysis results
        """
        pass

    @abstractmethod
    def health_check(self) -> bool:
        """
        Check if the LLM backend is accessible and healthy.

        Returns:
            True if healthy, False otherwise
        """
        pass

    @abstractmethod
    def get_model_info(self) -> Dict[str, Any]:
        """
        Get information about the current model.

        Returns:
            Dict with model name, version, capabilities, etc.
        """
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Return the model name being used."""
        pass

    @property
    @abstractmethod
    def backend_type(self) -> str:
        """Return the backend type (e.g., 'gemini', 'ollama')."""
        pass


def create_llm_client(backend: str, **kwargs) -> LLMClient:
    """
    Factory function to create LLM clients.

    Args:
        backend: Backend type ('gemini' or 'ollama')
        **kwargs: Backend-specific configuration

    Returns:
        Configured LLMClient instance

    Raises:
        ValueError: If backend is not supported
    """
    backend = backend.lower().strip()

    if backend == 'gemini':
        from .gemini_client import GeminiClient
        return GeminiClient(
            api_key=kwargs.get('api_key'),
            model=kwargs.get('model', 'gemini-2.0-flash')
        )
    elif backend == 'ollama':
        from .ollama_client import OllamaClient
        return OllamaClient(
            api_url=kwargs.get('api_url', 'http://localhost:11434'),
            model=kwargs.get('model', 'qwen2.5-coder:32b')
        )
    else:
        raise ValueError(f"Unsupported LLM backend: {backend}. Use 'gemini' or 'ollama'.")