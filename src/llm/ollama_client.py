"""Ollama API client for accessibility review."""

import json
import requests
from typing import Dict, List, Optional, Any

from .base import LLMClient, LLMResponse


class OllamaClient(LLMClient):
    """Ollama API client implementation."""

    def __init__(
        self,
        api_url: str = 'http://localhost:11434',
        model: str = 'qwen2.5-coder:32b'
    ):
        """
        Initialize the Ollama client.

        Args:
            api_url: Ollama API base URL
            model: Model name to use
        """
        self._api_url = api_url.rstrip('/')
        self._model_name = model
        self._timeout = 300  # 5 minutes timeout for long analyses

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def backend_type(self) -> str:
        return 'ollama'

    def _make_request(
        self,
        endpoint: str,
        data: Dict,
        stream: bool = False
    ) -> Dict:
        """Make a request to the Ollama API."""
        url = f"{self._api_url}/api/{endpoint}"

        try:
            response = requests.post(
                url,
                json=data,
                timeout=self._timeout,
                headers={'Content-Type': 'application/json'}
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Ollama API error: {str(e)}")

    def _ensure_model_available(self):
        """Pull the model if not available locally."""
        try:
            # Check if model exists
            response = requests.get(f"{self._api_url}/api/tags", timeout=30)
            response.raise_for_status()
            models = response.json().get('models', [])

            model_names = [m.get('name', '').split(':')[0] for m in models]

            # Check if model or base model name exists
            base_model = self._model_name.split(':')[0]
            if self._model_name not in [m.get('name') for m in models] and base_model not in model_names:
                print(f"Model {self._model_name} not found, pulling...")
                self._pull_model()
        except Exception as e:
            raise RuntimeError(f"Failed to check/pull model: {str(e)}")

    def _pull_model(self):
        """Pull the model from Ollama registry."""
        response = requests.post(
            f"{self._api_url}/api/pull",
            json={'name': self._model_name, 'stream': False},
            timeout=600  # 10 minutes for model pull
        )
        response.raise_for_status()

    def analyze_diff(
        self,
        diff_content: str,
        system_prompt: str,
        user_prompt: str,
        json_schema: Optional[Dict] = None
    ) -> LLMResponse:
        """Analyze diff using Ollama API."""
        # Ensure model is available
        self._ensure_model_available()

        # Build the request
        full_prompt = f"{system_prompt}\n\n{user_prompt}\n\n## Diff to Analyze:\n\n{diff_content}"

        request_data = {
            'model': self._model_name,
            'prompt': full_prompt,
            'stream': False,
            'options': {
                'temperature': 0.1,
                'top_p': 0.95,
                'num_ctx': 32768,  # Large context for diffs
            }
        }

        # Add structured output format if schema provided
        if json_schema:
            request_data['format'] = 'json'
            # Add schema hint in the prompt
            request_data['prompt'] = (
                f"{full_prompt}\n\n"
                f"IMPORTANT: Respond with valid JSON matching this schema:\n"
                f"{json.dumps(json_schema, indent=2)}\n\n"
                f"Respond ONLY with valid JSON, no markdown formatting."
            )

        try:
            response = self._make_request('generate', request_data)

            content = response.get('response', '')

            # Parse structured data if JSON schema was requested
            structured_data = None
            if json_schema and content:
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, list):
                        structured_data = parsed
                    elif isinstance(parsed, dict) and 'issues' in parsed:
                        structured_data = parsed['issues']
                except json.JSONDecodeError:
                    # Try to extract JSON from response
                    content = self._extract_json(content)
                    if content:
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
            if 'prompt_eval_count' in response or 'eval_count' in response:
                usage = {
                    'prompt_tokens': response.get('prompt_eval_count', 0),
                    'completion_tokens': response.get('eval_count', 0),
                    'total_tokens': response.get('prompt_eval_count', 0) + response.get('eval_count', 0)
                }

            return LLMResponse(
                content=content,
                model=self._model_name,
                usage=usage,
                structured_data=structured_data,
                raw_response=response
            )

        except Exception as e:
            raise RuntimeError(f"Ollama generation error: {str(e)}")

    def _extract_json(self, content: str) -> Optional[str]:
        """Extract JSON from content that might have surrounding text."""
        # Try to find JSON array or object
        import re

        # Try to match JSON array
        array_match = re.search(r'\[[\s\S]*?\]', content)
        if array_match:
            return array_match.group(0)

        # Try to match JSON object
        object_match = re.search(r'\{[\s\S]*?\}', content)
        if object_match:
            return object_match.group(0)

        return None

    def health_check(self) -> bool:
        """Check if Ollama server is running and model is available."""
        try:
            response = requests.get(f"{self._api_url}/api/tags", timeout=10)
            return response.status_code == 200
        except Exception:
            return False

    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the Ollama model."""
        info = {
            'backend': 'ollama',
            'model': self._model_name,
            'api_url': self._api_url,
            'provider': 'Local',
            'supports_json_schema': True
        }

        # Try to get model details
        try:
            response = requests.post(
                f"{self._api_url}/api/show",
                json={'name': self._model_name},
                timeout=10
            )
            if response.status_code == 200:
                model_info = response.json()
                info['model_size'] = model_info.get('size')
                info['model_family'] = model_info.get('details', {}).get('family')
        except Exception:
            pass

        return info