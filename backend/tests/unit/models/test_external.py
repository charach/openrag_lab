"""External LLM id parser — recognised providers + structured errors."""

from __future__ import annotations

import pytest

from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.external import (
    ExternalProvider,
    is_external_llm_id,
    parse_external_llm_id,
)


def test_is_external_llm_id_detects_prefix() -> None:
    assert is_external_llm_id("external:openai:gpt-4o-mini") is True
    assert is_external_llm_id("local-llama") is False
    assert is_external_llm_id("") is False


@pytest.mark.parametrize(
    ("llm_id", "expected_provider", "expected_model"),
    [
        ("external:openai:gpt-4o-mini", ExternalProvider.OPENAI, "gpt-4o-mini"),
        ("external:anthropic:claude-3-5-sonnet", ExternalProvider.ANTHROPIC, "claude-3-5-sonnet"),
        ("external:gemini:gemini-1.5-pro", ExternalProvider.GEMINI, "gemini-1.5-pro"),
        ("external:openrouter:meta/llama-3", ExternalProvider.OPENROUTER, "meta/llama-3"),
    ],
)
def test_parse_external_llm_id_for_each_provider(
    llm_id: str, expected_provider: ExternalProvider, expected_model: str
) -> None:
    ref = parse_external_llm_id(llm_id)
    assert ref.provider is expected_provider
    assert ref.model == expected_model


def test_parse_unknown_provider_raises_with_supported_list() -> None:
    with pytest.raises(ConfigurationError) as ei:
        parse_external_llm_id("external:mistral:medium")
    assert ei.value.code == "EXTERNAL_PROVIDER_UNKNOWN"
    assert ei.value.recoverable is False
    assert ei.value.details["provider_id"] == "mistral"
    assert set(ei.value.details["supported_providers"]) == {
        "openai",
        "anthropic",
        "gemini",
        "openrouter",
    }


@pytest.mark.parametrize(
    "bad",
    [
        "openai:gpt-4o",  # missing external: prefix
        "external:",  # empty provider
        "external:openai",  # missing model
        "external:openai:",  # empty model
    ],
)
def test_parse_malformed_id_raises(bad: str) -> None:
    with pytest.raises(ConfigurationError) as ei:
        parse_external_llm_id(bad)
    assert ei.value.code == "EXTERNAL_PROVIDER_UNKNOWN"
