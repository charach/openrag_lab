"""External LLM provider identifiers.

LLM ids carrying the ``external:<provider>:<model>`` shape route through one
of four supported providers. The parser is the single source of truth so
adapters/factories never touch raw strings.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from openrag_lab.domain.errors import ConfigurationError


class ExternalProvider(StrEnum):
    """Supported external LLM providers (ERROR_CODES.md §8)."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    OPENROUTER = "openrouter"


@dataclass(frozen=True)
class ExternalLLMRef:
    provider: ExternalProvider
    model: str


def is_external_llm_id(llm_id: str) -> bool:
    return llm_id.startswith("external:")


def parse_external_llm_id(llm_id: str) -> ExternalLLMRef:
    """Parse ``external:<provider>:<model>`` into a typed reference.

    Raises ``ConfigurationError`` with a stable code if the prefix is wrong
    or the provider is not one of the four supported ones.
    """
    if not is_external_llm_id(llm_id):
        raise ConfigurationError(
            f"외부 LLM id는 'external:<provider>:<model>' 형식이어야 합니다: {llm_id!r}",
            code="EXTERNAL_PROVIDER_UNKNOWN",
            recoverable=False,
            details={"llm_id": llm_id},
        )
    parts = llm_id.split(":", 2)
    if len(parts) != 3 or not parts[1] or not parts[2]:
        raise ConfigurationError(
            f"외부 LLM id 형식이 잘못되었습니다: {llm_id!r}",
            code="EXTERNAL_PROVIDER_UNKNOWN",
            recoverable=False,
            details={"llm_id": llm_id},
        )
    name = parts[1]
    try:
        provider = ExternalProvider(name)
    except ValueError as exc:
        raise ConfigurationError(
            f"지원하지 않는 외부 제공자입니다: {name!r}.",
            code="EXTERNAL_PROVIDER_UNKNOWN",
            recoverable=False,
            details={
                "provider_id": name,
                "supported_providers": [p.value for p in ExternalProvider],
            },
        ) from exc
    return ExternalLLMRef(provider=provider, model=parts[2])
