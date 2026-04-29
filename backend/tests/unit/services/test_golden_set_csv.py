"""GoldenSetService.parse_csv — happy path + validation."""

from __future__ import annotations

import pytest

from openrag_lab.domain.services.golden_set import parse_csv


def test_parses_header_and_two_rows() -> None:
    csv_text = "question,expected_answer\nWhat is RAG?,Retrieval-Augmented Generation\nq2,a2\n"
    pairs = parse_csv(csv_text)
    assert len(pairs) == 2
    assert pairs[0].question == "What is RAG?"
    assert pairs[0].expected_answer == "Retrieval-Augmented Generation"


def test_allows_empty_expected_answer() -> None:
    csv_text = "question,expected_answer\nq1,\n"
    pairs = parse_csv(csv_text)
    assert pairs[0].expected_answer is None


def test_question_only_header_supported() -> None:
    csv_text = "question\nq1\nq2\n"
    pairs = parse_csv(csv_text)
    assert [p.question for p in pairs] == ["q1", "q2"]
    assert all(p.expected_answer is None for p in pairs)


def test_empty_csv_rejected() -> None:
    with pytest.raises(ValueError, match="empty"):
        parse_csv("")


def test_missing_question_column_rejected() -> None:
    with pytest.raises(ValueError, match="question"):
        parse_csv("foo,bar\n1,2\n")


def test_blank_question_row_rejected() -> None:
    with pytest.raises(ValueError, match="empty question"):
        parse_csv("question,expected_answer\n,answer\n")


def test_unicode_questions_supported() -> None:
    csv_text = "question,expected_answer\n한국어 질문은?,한국어 대답\n"
    pairs = parse_csv(csv_text)
    assert pairs[0].question == "한국어 질문은?"
    assert pairs[0].expected_answer == "한국어 대답"
