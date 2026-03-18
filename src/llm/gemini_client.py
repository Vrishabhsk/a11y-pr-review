"""Gemini API client for accessibility review."""

import json
import os
from typing import Dict, List, Optional, Any

from .base import LLMClient, LLMResponse


class GeminiClient(LLMClient):
    """Google Gemini API client implementation."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = 'gemini-2.0-flash'
    ):
        """
        Initialize the Gemini client.

        Args:
            api_key: Google AI API key (can also be set via GEMINI_API_KEY env)
            model: Gemini model to use
        """
        self._api_key = api_key or os.getenv('GEMINI_API_KEY')
        if not self._api_key:
            raise ValueError("Gemini API key required. Set GEMINI_API_KEY environment variable or pass api_key parameter.")

        self._model_name = model
        self._client = None
        self._initialized = False

    def _ensure_client(self):
        """Lazy initialization of the Gemini client."""
        if self._initialized:
            return

        try:
            import google.generativeai as genai
        except ImportError:
            raise ImportError(
                "google-generativeai package not installed. "
                "Install it with: pip install google-generativeai"
            )

        genai.configure(api_key=self._api_key)
        self._client = genai.GenerativeModel(self._model_name)
        self._initialized = True

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def backend_type(self) -> str:
        return 'gemini'

    def analyze_diff(
        self,
        diff_content: str,
        system_prompt: str,
        user_prompt: str,
        json_schema: Optional[Dict] = None
    ) -> LLMResponse:
        """Analyze diff using Gemini API."""
        self._ensure_client()

        import google.generativeai as genai

        # Build the full prompt
        full_prompt = f"{system_prompt}\n\n{user_prompt}\n\n## Diff to Analyze:\n\n{diff_content}"

        # Configure for JSON output if schema provided
        generation_config = {
            'temperature': 0.1,  # Low temperature for consistent analysis
            'top_p': 0.95,
        }

        if json_schema:
            # Use response_schema for structured output (Gemini 1.5+)
            generation_config['response_mime_type'] = 'application/json'
            generation_config['response_schema'] = json_schema

        try:
            model = genai.GenerativeModel(
                self._model_name,
                generation_config=generation_config
            )

            response = model.generate_content(full_prompt)

            # Extract content
            content = response.text

            # Parse structured data if JSON
            structured_data = None
            if json_schema and content:
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, list):
                        structured_data = parsed
                    elif isinstance(parsed, dict) and 'issues' in parsed:
                        structured_data = parsed['issues']
                except json.JSONDecodeError:
                    pass

            # Extract usage info
            usage = None
            if hasattr(response, 'usage_metadata'):
                usage = {
                    'prompt_tokens': getattr(response.usage_metadata, 'prompt_token_count', 0),
                    'completion_tokens': getattr(response.usage_metadata, 'candidates_token_count', 0),
                    'total_tokens': getattr(response.usage_metadata, 'total_token_count', 0)
                }

            return LLMResponse(
                content=content,
                model=self._model_name,
                usage=usage,
                structured_data=structured_data,
                raw_response=response
            )

        except Exception as e:
            raise RuntimeError(f"Gemini API error: {str(e)}")

    def health_check(self) -> bool:
        """Check if Gemini API is accessible."""
        try:
            self._ensure_client()
            import google.generativeai as genai

            # Try to list models as a health check
            models = list(genai.list_models())
            return len(models) > 0
        except Exception:
            return False

    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the Gemini model."""
        return {
            'backend': 'gemini',
            'model': self._model_name,
            'provider': 'Google',
            'supports_json_schema': True,
            'supports_vision': 'vision' in self._model_name.lower() or 'gemini-2' in self._model_name
        }