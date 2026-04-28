"""NullLLM + EchoLLM behaviours."""

from __future__ import annotations

import pytest

from openrag_lab.adapters.llms.null import EchoLLM, NullLLM
from openrag_lab.domain.errors import ConfigurationError


async def test_null_llm_refuses_generate() -> None:
    llm = NullLLM()
    with pytest.raises(ConfigurationError) as ei:
        await llm.generate("anything")
    assert ei.value.code == "LLM_NOT_CONFIGURED"


async def test_null_llm_refuses_stream() -> None:
    llm = NullLLM()
    with pytest.raises(ConfigurationError):
        async for _ in llm.stream("anything"):
            pass


async def test_echo_llm_returns_deterministic_response() -> None:
    llm = EchoLLM()
    a = await llm.generate("hello")
    b = await llm.generate("hello")
    assert a == b
    assert "echo[" in a
    assert "hello" in a


async def test_echo_llm_streams_in_chunks() -> None:
    llm = EchoLLM()
    chunks = [c async for c in llm.stream("a long prompt " * 20)]
    assert "".join(chunks).startswith("echo[")
    assert len(chunks) >= 2  # streamed in pieces


def test_null_metadata() -> None:
    llm = NullLLM()
    assert llm.model_id == "null"
    assert llm.is_local is True
    assert llm.active_backend is None
