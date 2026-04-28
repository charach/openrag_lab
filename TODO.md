# TODO — MVP 2-4주

> **범위**: P0만. P1·P2는 [docs/REQUIREMENTS_v4.md](docs/REQUIREMENTS_v4.md) §3·§7 참조.
> **작업 룰**: [docs/CLAUDE.md](docs/CLAUDE.md) 황금률 5가지 + 절대 금지 6항목 엄수.
> **수직 슬라이스 우선**: 한 phase 끝나야 다음으로. Phase 1 끝에 빈약하더라도 인덱싱-검색이 한 번 돌아가게.

---

## 🌙 내일 시작 지점 (2026-04-28 → 2026-04-29)

**먼저 할 일**: chunker WIP 복원 + TC 수정.

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /Users/sukhwanyun/code/OpenRag_Lab

# 1. 어제 stash 한 chunker 코드+TC 복원
git stash pop                  # stash@{0}: phase1 chunker WIP

# 2. TC를 ChunkingConfig 검증 룰에 맞게 수정 — 모든 chunk_size를 >=32로,
#    text 길이도 비례해서 늘리기. CONFIG_SCHEMA.md §4.3.1 (32~4096 토큰).
#    수정 대상:
#      backend/tests/integration/adapters/chunkers/test_fixed.py
#      backend/tests/integration/adapters/chunkers/test_recursive.py

# 3. 검증
uv run pytest backend/tests/integration/adapters/chunkers/ -v
uv run ruff check . && uv run ruff format --check . && uv run mypy backend/src && uv run lint-imports
```

⚠️ stash 사유: TC 작성 시 `chunk_size=4, 5, 10` 등 작은 값을 썼는데 ChunkingConfig는 `>=32` 강제. production 코드(`fixed.py`, `recursive.py`)는 이상 없으나 32+ 값으로 직접 검증은 미실행.

**그 다음 순서** (Phase 1 라이트 잔여):
1. `infra/fs/workspace_layout.py` (OS별 경로, [docs/PLATFORM.md](docs/PLATFORM.md) §2) + TC
2. `infra/cache/{parse_cache, embedding_cache}` + TC
3. `infra/hardware/probe.py` + TC
4. (선택) `infra/db/repositories/` 레포 4종 + TC

**Phase 1 헤비 (별도 세션 권장 — 대용량 다운로드/컴파일)**:
- `adapters/parsers/pdf_pymupdf.py` (pymupdf wheel)
- `adapters/embedders/sentence_transformers.py` (PyTorch + 모델 다운로드)
- `adapters/vector_stores/chroma.py` (chromadb)
- `adapters/llms/llama_cpp.py` (C++ 빌드 + GGUF 모델)
- `adapters/evaluators/llm_judge.py` (llm 어댑터 의존)

---

## Phase 0 — 스캐폴딩 ✅ 완료

기반 잡기. 여기서 모듈 경계가 잘못되면 이후 전부에 영향.

- [x] `pyproject.toml` + `uv.lock` (Python 3.11)
- [x] `backend/{app,domain,adapters,infra,config,tests}/` 디렉토리 + `__init__.py`
- [x] `frontend/` Vite + React + TypeScript 초기화 (pnpm)
- [x] pre-commit: ruff, ruff format, mypy, lint-imports → [.pre-commit-config.yaml](.pre-commit-config.yaml)
- [x] **import-linter**: `domain/` 외부 lib·`adapters/`·`infra/`·`app/` 차단 → [.importlinter](.importlinter), 2 contracts KEPT
- [x] GitHub Actions CI 매트릭스: `macos-14`, `windows-latest`, `ubuntu-22.04` × Python 3.11 → [.github/workflows/backend.yml](.github/workflows/backend.yml) + [frontend.yml](.github/workflows/frontend.yml)
- [x] 핵심 도메인 모델 8 파일 (errors, ids, enums, document, chunk, embedding, retrieval, experiment, workspace)
- [x] SQLite 스키마 + 마이그레이션 — [schema.sql](backend/src/openrag_lab/infra/db/schema.sql), [migrations.py](backend/src/openrag_lab/infra/db/migrations.py), [sqlite.py](backend/src/openrag_lab/infra/db/sqlite.py)
- [x] `ChunkingConfig.cache_key()`, `ExperimentConfig.fingerprint()` 결정성 TC

**검증 완료**: ruff ✓ / ruff format ✓ / mypy strict (34 files) ✓ / import-linter (2 contracts kept) ✓ / pytest **59 passed** / frontend typecheck + vitest + build ✓

---

## Phase 1 — 어댑터 수직 슬라이스 (1주) — 🟡 진행 중

도메인 인터페이스 → 어댑터 → infra. 끝나면 인덱싱-검색이 한 번 돈다.

### 도메인 포트 정의 ✅
- [x] `domain/ports/` Protocol 6종: parser, chunker, embedder, vector_store, llm, evaluator_judge → [domain/ports/](backend/src/openrag_lab/domain/ports/)
- [x] `domain/errors.py` 예외 계층 — Phase 0에서 함께 작성 → [errors.py](backend/src/openrag_lab/domain/errors.py)

### 어댑터 — 라이트 (순수 로직)
- [x] `adapters/parsers/txt.py` + TC 9개 통과 ✓
- [x] `adapters/parsers/markdown.py` + TC 5개 통과 ✓ (frontmatter 스트립 포함)
- [⚠️ stash@{0}] `adapters/chunkers/fixed.py` — 코드 + TC 작성, TC `chunk_size<32` 위반으로 stash 처리 (내일 복원 + 수정)
- [⚠️ stash@{0}] `adapters/chunkers/recursive.py` — 동일 사유로 stash

### 어댑터 — 헤비 (별도 세션, 대용량 의존성)
- [ ] `adapters/parsers/pdf_pymupdf.py` (pymupdf wheel 필요)
- [ ] `adapters/embedders/sentence_transformers.py` — 백엔드 자동 선택 ([docs/PLATFORM.md](docs/PLATFORM.md) §3.3) — PyTorch + 모델 다운로드
- [ ] `adapters/vector_stores/chroma.py` — 차원별 컬렉션 분리 (`vectors_<embedder_id_short>_<dim>`) — chromadb 설치
- [ ] `adapters/llms/llama_cpp.py` — 로컬 LLM (외부 LLM은 P1) — C++ 빌드 + GGUF 모델
- [ ] `adapters/evaluators/llm_judge.py` — 4개 지표 (LLM 어댑터 선행 필요)

### Infra
- [x] `infra/db/sqlite.py` + 마이그레이션 — Phase 0에서 작성, TC 7개 통과
- [ ] `infra/db/repositories/` (workspace, document, chunk, experiment, golden_set 5종)
- [ ] `infra/cache/`: embedding_cache, parse_cache (캐시 키 [docs/ARCHITECTURE_v3.md](docs/ARCHITECTURE_v3.md) §8.3)
- [ ] `infra/fs/workspace_layout.py` — OS별 표준 경로 ([docs/PLATFORM.md](docs/PLATFORM.md) §2)
- [ ] `infra/hardware/probe.py` — CPU/RAM/GPU 탐지

### 검증
- [ ] 각 어댑터 통합 테스트 — [docs/PLATFORM.md](docs/PLATFORM.md) §9 어댑터 체크리스트 통과
- [x] 한글·이모지·공백 경로 fixture 포함 — txt 파서 TC, workspace meta TC에서 적용 중

---

## Phase 2 — 도메인 서비스 (1주)

오케스트레이션 + 비즈니스 로직.

- [ ] `IndexingService` — 체크포인트 재개 (PARSED → CHUNKED → EMBEDDED, [docs/ARCHITECTURE_v3.md](docs/ARCHITECTURE_v3.md) §6.1)
- [ ] `RetrievalService` — Dense만 (Sparse·Hybrid는 P1)
- [ ] `EvaluationService` — 4개 지표, 검색 전용 모드 시 LLM 의존 지표 `null`
- [ ] `GoldenSetService` — 직접 입력 + CSV 업로드
- [ ] `HardwareProfiler` + `PresetRecommender` — 하드웨어 → 모델 추천
- [ ] `RAGPipeline` — `is_retrieval_only` 분기점, 검색 전용 모드 P0
- [ ] `TaskQueue` (asyncio.Semaphore, max_concurrent=1) + `CancellationToken`

---

## Phase 3 — API + UI (1주)

REST/WS 계약을 깔고 4개 화면.

### 백엔드 API
- [ ] `app/main.py` FastAPI 셋업 + DI
- [ ] REST 엔드포인트 ([docs/API_SPEC_v4.md](docs/API_SPEC_v4.md)): workspaces / documents / chunking / indexing / chat / experiments / system
- [ ] WebSocket Hub (progress, log, token, error, complete)
- [ ] 에러 미들웨어 — 도메인 예외 → [docs/ERROR_CODES.md](docs/ERROR_CODES.md) §12 매핑
- [ ] `runtime.lock` 단일 인스턴스 보장 ([docs/PLATFORM.md](docs/PLATFORM.md) §5.4)
- [ ] OpenAPI → 프런트 타입 자동 생성

### 프런트
- [ ] `AutoPilotWizard.tsx` — 비전문가 흐름
- [ ] `ChatView.tsx` — citation + 토큰 스트리밍 + 검색 전용 배지
- [ ] `ChunkingLab.tsx` — preview, 청크 색상 오버레이
- [ ] `ExperimentMatrix.tsx` + `ExperimentResults.tsx` — A/B 차트 (Recharts)
- [ ] WS 훅 + Zustand 스토어 4종

---

## Phase 4 — 마무리 (3일)

- [ ] `/config/export`, `/config/import` — [docs/CONFIG_SCHEMA.md](docs/CONFIG_SCHEMA.md) §7 검증 모두
- [ ] 글로벌 `<OPENRAG_HOME>/settings.yaml` 로드 (network 섹션 포함, [docs/PLATFORM.md](docs/PLATFORM.md) §11)
- [ ] E2E 시나리오 3개 (Playwright):
  1. Auto-Pilot — PDF 업로드 → 인덱싱 → 채팅
  2. A/B — 두 청크 크기로 인덱싱 → 평가 → 차트
  3. YAML 라운드트립 — export → 빈 워크스페이스 import → 동일 검색 결과
- [ ] 3 OS CI 모두 그린
- [ ] README "빠른 시작" 직접 따라가서 동작 확인

---

## PR 체크리스트 (작업 내내)

매 PR마다:

- [ ] `domain/`에 외부 라이브러리 import 없음 (import-linter 통과)
- [ ] OS 분기는 `adapters/`·`infra/`만 (도메인 코드에 `sys.platform` 금지)
- [ ] `pathlib.Path`만, 문자열 결합 금지
- [ ] 새 에러는 [docs/ERROR_CODES.md](docs/ERROR_CODES.md) 먼저 등록 후 도메인 예외로 발생
- [ ] async 함수에서 동기 I/O 금지 (`asyncio.to_thread` 사용)
- [ ] `print()` 금지 — 구조화 로깅
- [ ] 어댑터 추가 시 [docs/PLATFORM.md](docs/PLATFORM.md) §9 체크리스트 9항목 통과
- [ ] 3 OS CI 통과

---

## 의도적으로 제외 (P1·P2)

다음은 MVP에 끼우지 않는다 — 끝낸 뒤 추가:

- 외부 LLM 어댑터 (OpenRouter / Gemini / OpenAI / Anthropic) — P1
- 시멘틱·문장 청킹 — P1
- Sparse / Hybrid 검색 — P1
- 리랭커 — P2
- DOCX / HTML / JSON / EPUB 파싱 — P1
- API 키 keystore + `infra/external/http_client.py` 본구현 — P1 (외부 LLM과 함께)
- 매트릭스 평가 (`/experiments/batch`) — P1
- Docker / 단일 바이너리 / 코드 사이닝 — P2
