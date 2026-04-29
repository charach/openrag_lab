# OpenRAG-Lab

> **로컬 지능형 RAG 워크벤치** — 자기 문서로 RAG 시스템을 만들고, 임베딩·청킹·검색·LLM 조합의 품질을 정량적으로 비교하는 도구.

[![status](https://img.shields.io/badge/status-MVP_complete-green)]()
[![tests](https://img.shields.io/badge/pytest-336_passed-brightgreen)]()
[![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-blue)]()

---

## 무엇을 하는가

- 📂 **PDF · TXT · Markdown 인덱싱** — 드래그-앤-드롭 업로드, 체크포인트 기반 재개
- 🔍 **청킹 · 임베딩 · 검색 전략 비교** — 슬라이더로 chunk_size/overlap 즉시 미리보기
- 📊 **RAGAS 4지표 A/B 평가** — Faithfulness · Answer Relevance · Context Precision/Recall
- 🤖 **검색 전용 모드** — LLM 없이 검색 품질만 측정 (P0 first-class)
- 🔌 **어댑터로 격리** — 임베더·벡터스토어·LLM·judge 모두 교체 가능
- 💾 **YAML 익스포트/임포트** — fingerprint로 결정적 재현
- 🌐 **3 OS 1급 지원** — macOS · Windows · Linux 동등 (CI 매트릭스 그린)

모든 데이터는 로컬에 머문다. 외부 LLM API는 사용자가 명시적으로 키를 등록한 경우에만 호출된다 (P1).

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 백엔드 | Python 3.11 + FastAPI + asyncio TaskQueue |
| 벡터 저장소 | ChromaDB (운영) / In-memory NumPy (테스트) |
| 임베딩 | sentence-transformers (운영) / FakeEmbedder (테스트) |
| 메타데이터 | SQLite (워크스페이스당 1 파일) |
| 프런트 | React + Vite + TypeScript + Zustand + Recharts |
| 패키징 | uv (Python) + pnpm (Node) |
| E2E | Playwright (Chromium) |

전체 구조와 모듈 지도는 [ARCHITECTURE.md](ARCHITECTURE.md) 참조.

---

## 빠른 시작

전제 조건:
- [uv](https://docs.astral.sh/uv/) (Python 관리)
- [pnpm](https://pnpm.io/) + Node 20+

### 1. 한 번만 — 의존성 설치 + 헬스체크

```bash
git clone <this-repo> && cd OpenRag_Lab
uv sync
uv run pytest backend/tests          # 336 passed 확인

cd frontend
pnpm install
pnpm test                            # 3 passed 확인
```

### 2. 개발 서버 (터미널 두 개)

```bash
# 터미널 A — 백엔드 (127.0.0.1:8000)
uv run uvicorn openrag_lab.app.main:create_app --factory --reload
```

```bash
# 터미널 B — 프런트 (http://localhost:5173)
cd frontend
pnpm dev
```

브라우저에서 `http://localhost:5173` 접속 → **Auto-Pilot** 화면이 뜨면 ✓

### 3. 4 화면 둘러보기

| 경로 | 화면 | 무엇을 하나 |
|---|---|---|
| `/` | Auto-Pilot | 프리셋 선택 → 워크스페이스 + 문서 업로드 → 인덱싱 진행률 (WS) |
| `/chunking` | Chunking Lab | 슬라이더로 chunk_size·overlap 변경, 색상 오버레이 미리보기 |
| `/chat` | Chat | 실험 선택 → 질문 → citation 청크 + 답변 (검색 전용 모드면 배지) |
| `/experiments` | Experiment Matrix | RAGAS 4지표 표 + 그룹 막대그래프 A/B 비교 |

---

## 가벼운 모드 — 모델 다운로드 없이 부팅

실제 sentence-transformers / Chroma 없이도 전체 API를 돌릴 수 있다. 데모·E2E·CI에 사용.

```bash
OPENRAG_LAB_TEST_MODE=1 uv run uvicorn openrag_lab.app.main:create_app --factory
```

`FakeEmbedder` (sha256 기반 32차원 결정적 벡터) + `InMemoryVectorStore` + `EchoLLM`로 어댑터가 교체된다. API 표면은 운영과 동일.

---

## E2E 테스트

```bash
cd frontend
pnpm exec playwright install --with-deps chromium    # 한 번
pnpm e2e                                              # 3 시나리오
```

세 시나리오:
1. **Auto-Pilot** — txt 업로드 → 인덱싱 → 검색 전용 채팅
2. **A/B 매트릭스** — 두 청크 크기 → 두 fingerprint 다름 검증
3. **YAML 라운드트립** — export → 빈 워크스페이스 import → fingerprint 동일

---

## 문서 인덱스

| 문서 | 다루는 영역 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | **현재 구현된 시스템의 한 페이지 지도** |
| [docs/REQUIREMENTS_v4.md](docs/REQUIREMENTS_v4.md) | P0/P1/P2 무엇을 만드는가 |
| [docs/ARCHITECTURE_v3.md](docs/ARCHITECTURE_v3.md) | 설계 의도 + 결정 배경 |
| [docs/API_SPEC_v4.md](docs/API_SPEC_v4.md) | REST + WebSocket 계약 |
| [docs/PLATFORM.md](docs/PLATFORM.md) | OS·경로·GPU·네트워크 단일 진실 공급원 |
| [docs/CONFIG_SCHEMA.md](docs/CONFIG_SCHEMA.md) | 워크스페이스 YAML 스키마 |
| [docs/ERROR_CODES.md](docs/ERROR_CODES.md) | 에러 코드 카탈로그 |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | 작업 컨벤션 + 금지 사항 |
| [PROBLEM.md](PROBLEM.md) | 최종 체크 시 발견 이슈 + 수정 내역 |
| [TODO.md](TODO.md) | Phase 진행 상황 + 다음 단계 |

처음 합류하는 사람은 **README.md → ARCHITECTURE.md → docs/REQUIREMENTS_v4.md** 순서를 권장.

---

## 프로젝트 상태

Phase 0–4 (MVP) 구현 완료:

- ✅ 도메인 모델 + 6 어댑터 카테고리 (parser·chunker·embedder·vector store·LLM·judge)
- ✅ FastAPI REST 9 라우터 + `/ws` WebSocket
- ✅ React + Vite 프런트 4 화면
- ✅ 글로벌 settings.yaml (network 섹션)
- ✅ Playwright E2E 3 시나리오
- ✅ 3 OS CI 매트릭스 (macos-14 · windows-latest · ubuntu-22.04)
- ✅ pytest **336** / vitest 3 / e2e 3 / mypy strict (95 files) / import-linter / ruff

다음 단계는 P1 — 외부 LLM 어댑터 4종, 시멘틱·문장 청킹, Sparse·Hybrid 검색, DOCX/HTML 파서, 매트릭스 평가. 자세한 백로그는 [TODO.md](TODO.md).

---

## 라이선스

미정 (첫 외부 배포 전 결정).
