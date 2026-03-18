"""Prompt templates for accessibility review."""

from .a11y_prompt import (
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
    build_user_prompt,
    build_json_schema,
)
from .severity import (
    Severity,
    classify_severity,
    get_severity_order,
)

__all__ = [
    'SYSTEM_PROMPT',
    'USER_PROMPT_TEMPLATE',
    'build_user_prompt',
    'build_json_schema',
    'Severity',
    'classify_severity',
    'get_severity_order',
]