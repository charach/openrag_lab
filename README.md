# OpenRAG-Lab

> **로컬 지능형 RAG 워크벤치** — 사용자가 자신의 PC에서 개인 문서로 RAG 시스템을 만들고, 그 품질을 정량적으로 비교·튜닝할 수 있는 도구.

[![status](https://img.shields.io/badge/status-MVP_dev-green)]()
[![mvp](https://img.shields.io/badge/MVP-Phase_4-orange)]()
[![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-green)]()

---

## 30초 요약

OpenRAG-Lab은 **로컬에서만 동작하는 RAG 실험 환경**이다. 클라우드 의존성 없이:

- 📂 PDF·TXT·Markdown 드래그-앤-드롭 인덱싱
- 🔍 임베딩 모델·청크 크기·검색 전략 조합 비교
- 📊 4개 정량 지표(Faithfulness, Answer Relevance, Context Precision/Recall) A/B 평가
- 🤖 LLM 없이 검색 성능만 측정하는 모드 지원
- 🔌 외부 LLM (OpenRouter / Gemini / OpenAI / Anthropic) 옵트인 활성화
- 💾 모든 설정을 단일 YAML로 익스포트 → 다른 PC에서 재현

세 OS(macOS · Windows · Linux) 모두 1급 시민으로 동등 지원.

---

## 현재 상태

Phase 0–4 구현 완료 (2026-04-29 기준):

- ✅ 도메인 모델 + 어댑터 (parser/chunker/embedder/vector store/LLM/judge)
- ✅ FastAPI REST + `/ws` WebSocket — 워크스페이스, 문서, 청킹 미리보기, 인덱싱, 채팅, 골든셋, 실험, 평가, 설정 익스포트/임포트
- ✅ React + Vite 프런트 4 화면 (Auto-Pilot, Chunking Lab, Chat, Experiment Matrix)
- ✅ 글로벌 `settings.yaml` 로더 (network 섹션)
- ✅ Playwright E2E 시나리오 3개
- ✅ pytest 333 / vitest 3 / e2e 3 / mypy strict / import-linter / 3 OS CI 매트릭스

---

## 문서

전체 설계 문서는 [docs/README.md](./docs/README.md)에서 시작한다. 진입 순서:

1. [docs/REQUIREMENTS_v4.md](./docs/REQUIREMENTS_v4.md) — 무엇을 만드는가
2. [docs/ARCHITECTURE_v3.md](./docs/ARCHITECTURE_v3.md) — 어떻게 만드는가
3. [docs/API_SPEC_v4.md](./docs/API_SPEC_v4.md) — REST + WebSocket 계약
4. [docs/PLATFORM.md](./docs/PLATFORM.md) — OS별 차이의 단일 진실 공급원
5. [docs/CONFIG_SCHEMA.md](./docs/CONFIG_SCHEMA.md) — 워크스페이스 YAML 스키마
6. [docs/ERROR_CODES.md](./docs/ERROR_CODES.md) — 에러 코드 카탈로그

기여자는 [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)부터, AI 에이전트는 [docs/CLAUDE.md](./docs/CLAUDE.md)부터 읽는다.

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 백엔드 | Python 3.11 + FastAPI |
| 비동기 | asyncio + 자체 작업 큐 |
| 벡터 저장소 | ChromaDB (임베디드) |
| 임베딩 | sentence-transformers |
| 로컬 LLM | llama.cpp (llama-cpp-python) |
| 메타데이터 | SQLite |
| 프런트엔드 | React + Vite + TypeScript |
| 패키징 | uv (Python) + pnpm (Node) |

모든 외부 라이브러리는 어댑터 인터페이스 뒤에 격리되어 교체 가능하다 — [docs/ARCHITECTURE_v3.md](./docs/ARCHITECTURE_v3.md) §2 참조.

---

## 빠른 시작 (개발 모드)

전제: [uv](https://docs.astral.sh/uv/) (Python), [pnpm](https://pnpm.io/) (Node 20+).

```bash
# 1. 백엔드 의존성 + 테스트 (한 번)
git clone <this-repo> && cd OpenRag_Lab
uv sync
uv run pytest backend/tests          # 333 passed 확인

# 2. 백엔드 dev 서버 (터미널 A, 127.0.0.1:8000)
uv run uvicorn openrag_lab.app.main:create_app --factory --reload

# 3. 프런트 dev 서버 (터미널 B, http://localhost:5173)
cd frontend
pnpm install
pnpm dev
```

브라우저에서 `http://localhost:5173` 접속 → Auto-Pilot 페이지가 뜨면 ✓.

### 테스트 모드로 빠르게 확인

`OPENRAG_LAB_TEST_MODE=1` 환경변수를 주면 sentence-transformers / Chroma 없이도 부트한다 (deterministic Fake 어댑터). 데모·E2E·CI에서 쓴다.

```bash
OPENRAG_LAB_TEST_MODE=1 uv run uvicorn openrag_lab.app.main:create_app --factory
```

### E2E 스모크 (Playwright)

```bash
cd frontend
pnpm exec playwright install --with-deps chromium    # 한 번
pnpm e2e                                              # 3 시나리오 통과
```

---

## 라이선스

미정 (첫 코드 커밋 전 결정).
