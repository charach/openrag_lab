"""``make_external_llm_factory`` — id parsing → adapter dispatch + key gating."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from openrag_lab.adapters.llms.anthropic import AnthropicLLM
from openrag_lab.adapters.llms.gemini import GeminiLLM
from openrag_lab.adapters.llms.litellm import (
    DEFAULT_BASE_URL as LITELLM_DEFAULT,
    LiteLLMLLM,
)
from openrag_lab.adapters.llms.null import NullLLM
from openrag_lab.adapters.llms.ollama import DEFAULT_BASE_URL, OllamaLLM
from openrag_lab.adapters.llms.openai import OpenAILLM
from openrag_lab.adapters.llms.openrouter import OpenRouterLLM
from openrag_lab.app.services.runtime import (
    make_default_factories,
    make_external_llm_factory,
)
from openrag_lab.config.settings import ExternalSettings
from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.external import ExternalProvider
from openrag_lab.infra.external.keystore import Keystore


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))


def _keystore_with(tmp_path: Path, **keys: str) -> Keystore:
    ks = Keystore(tmp_path / "api_keys.yaml")
    for provider_name, key in keys.items():
        ks.set(ExternalProvider(provider_name), key)
    return ks


def test_empty_or_local_id_returns_null_llm(tmp_path: Path) -> None:
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    assert isinstance(factory(""), NullLLM)
    assert isinstance(factory("local-llama"), NullLLM)


@pytest.mark.parametrize(
    ("llm_id", "provider_name", "expected_type"),
    [
        ("external:openai:gpt-4o", "openai", OpenAILLM),
        ("external:anthropic:claude-3-5-sonnet", "anthropic", AnthropicLLM),
        ("external:gemini:gemini-1.5-pro", "gemini", GeminiLLM),
        ("external:openrouter:meta-llama/llama-3-8b", "openrouter", OpenRouterLLM),
    ],
)
def test_routes_each_provider_when_key_registered(
    tmp_path: Path,
    llm_id: str,
    provider_name: str,
    expected_type: type,
) -> None:
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path, **{provider_name: "k-test"}),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    llm = factory(llm_id)
    assert isinstance(llm, expected_type)
    assert llm.model_id == llm_id


def test_missing_key_raises_not_registered(tmp_path: Path) -> None:
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path),  # empty
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    with pytest.raises(ConfigurationError) as ei:
        factory("external:openai:gpt-4o")
    assert ei.value.code == "EXTERNAL_API_KEY_NOT_REGISTERED"
    assert ei.value.recoverable is True
    assert ei.value.details["provider_id"] == "openai"


def test_unknown_provider_raises(tmp_path: Path) -> None:
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    with pytest.raises(ConfigurationError) as ei:
        factory("external:mistral:medium")
    assert ei.value.code == "EXTERNAL_PROVIDER_UNKNOWN"


def test_allow_llm_api_false_blocks_external_call(tmp_path: Path) -> None:
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path, openai="k"),
        external_settings=ExternalSettings(allow_llm_api=False),
        http_client=_client(),
    )
    with pytest.raises(ConfigurationError) as ei:
        factory("external:openai:gpt-4o")
    assert ei.value.code == "EXTERNAL_API_NOT_ENABLED"


def test_provider_not_in_allow_list_blocked(tmp_path: Path) -> None:
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path, openai="k"),
        external_settings=ExternalSettings(allowed_providers=("anthropic",)),
        http_client=_client(),
    )
    with pytest.raises(ConfigurationError) as ei:
        factory("external:openai:gpt-4o")
    assert ei.value.code == "EXTERNAL_PROVIDER_NOT_ALLOWED"
    assert ei.value.details["provider"] == "openai"


def test_ollama_works_without_registered_key_using_default_base(tmp_path: Path) -> None:
    """Ollama is the local HTTP provider — no key required to instantiate."""
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path),  # nothing registered
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    llm = factory("external:ollama:llama3")
    assert isinstance(llm, OllamaLLM)
    assert llm.model_id == "external:ollama:llama3"
    # The adapter should fall back to the documented localhost default.
    assert llm._base == DEFAULT_BASE_URL  # type: ignore[attr-defined]


def test_ollama_uses_registered_url_override(tmp_path: Path) -> None:
    """Registered keystore value is treated as the base URL override."""
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path, ollama="http://gpu-host:11434"),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    llm = factory("external:ollama:mistral")
    assert isinstance(llm, OllamaLLM)
    assert llm._base == "http://gpu-host:11434"  # type: ignore[attr-defined]


def test_litellm_works_without_registered_key_using_default_base(tmp_path: Path) -> None:
    """LiteLLM is treated like Ollama when no slot is registered."""
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    llm = factory("external:litellm:gpt-4o-mini")
    assert isinstance(llm, LiteLLMLLM)
    assert llm.model_id == "external:litellm:gpt-4o-mini"
    assert llm._base == LITELLM_DEFAULT  # type: ignore[attr-defined]
    assert llm._api_key == ""  # type: ignore[attr-defined]


def test_litellm_url_only_keystore(tmp_path: Path) -> None:
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path, litellm="http://lite:4000"),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    llm = factory("external:litellm:claude-3-5-sonnet")
    assert isinstance(llm, LiteLLMLLM)
    assert llm._base == "http://lite:4000"  # type: ignore[attr-defined]
    assert llm._api_key == ""  # type: ignore[attr-defined]


def test_litellm_url_and_bearer_keystore(tmp_path: Path) -> None:
    """``<url>|<key>`` slot splits into base URL + bearer for the adapter."""
    factory = make_external_llm_factory(
        keystore=_keystore_with(tmp_path, litellm="http://lite:4000|sk-virt-9"),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    llm = factory("external:litellm:gpt-4o-mini")
    assert isinstance(llm, LiteLLMLLM)
    assert llm._base == "http://lite:4000"  # type: ignore[attr-defined]
    assert llm._api_key == "sk-virt-9"  # type: ignore[attr-defined]


def test_make_default_factories_judge_uses_same_llm_router(tmp_path: Path) -> None:
    facts = make_default_factories(
        keystore=_keystore_with(tmp_path, anthropic="k"),
        external_settings=ExternalSettings(),
        http_client=_client(),
    )
    judge = facts.judge("external:anthropic:claude-3-5-sonnet")
    # LLMJudge wraps an LLM; the inner attribute name may vary, so we just
    # verify the judge was constructible (i.e. the factory routed).
    assert judge is not None
