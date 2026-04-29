# TODO — MVP 2-4주

> **범위**: P0만. P1·P2는 [docs/REQUIREMENTS_v4.md](docs/REQUIREMENTS_v4.md) §3·§7 참조.
> **작업 룰**: [docs/CLAUDE.md](docs/CLAUDE.md) 황금률 5가지 + 절대 금지 6항목 엄수.
> **수직 슬라이스 우선**: 한 phase 끝나야 다음으로.

---

## 🌙 다음 시작 지점 (2026-04-29 시점)

Phase 0·1·2 완료. **Phase 3부터** 시작.

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /Users/sukhwanyun/code/OpenRag_Lab
uv run pytest backend/tests/  # 253 passed 확인
```

**Phase 3 시작 순서** (API + UI):
1. `app/main.py` FastAPI 셋업 + DI
2. REST 엔드포인트 ([docs/API_SPEC_v4.md](docs/API_SPEC_v4.md))
3. WebSocket Hub
4. 프런트 4 화면 (Auto-Pilot, Chat, ChunkingLab, ExperimentMatrix)

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

## Phase 1 — 어댑터 수직 슬라이스 ✅ 완료

도메인 인터페이스 → 어댑터 → infra. 인덱싱-검색이 end-to-end 동작 확인됨.

### 도메인 포트 정의 ✅
- [x] `domain/ports/` Protocol 6종: parser, chunker, embedder, vector_store, llm, evaluator_judge
- [x] `domain/errors.py` 예외 계층

### 어댑터 — 라이트 ✅
- [x] `adapters/parsers/txt.py` + TC 9개
- [x] `adapters/parsers/markdown.py` + TC 5개 (frontmatter 스트립)
- [x] `adapters/chunkers/fixed.py` + `_token.py` + TC
- [x] `adapters/chunkers/recursive.py` + TC (separator priority, Korean boundary)
- 합계: chunker 31 TC

### 어댑터 — 헤비 ✅
- [x] `adapters/parsers/pdf_pymupdf.py` + TC 7개 (encrypted/empty/missing 포함)
- [x] `adapters/embedders/fake.py` (deterministic) + `sentence_transformers_embedder.py` (실제) + TC 7개
- [x] `adapters/vector_stores/in_memory.py` (브루트포스 NumPy) + `chroma.py` (PersistentClient) + TC 14개
- [x] `adapters/llms/null.py` (NullLLM + EchoLLM) + TC 5개
- [x] `adapters/evaluators/llm_judge.py` (RAGAS 4지표) + TC 6개
- ⏸️ `adapters/llms/llama_cpp.py` — P1 보류 (C++ 빌드 + GGUF 모델 부담). 외부 LLM 어댑터 도입 시 함께 처리.

### Infra ✅
- [x] `infra/db/sqlite.py` + 마이그레이션 — Phase 0
- [x] `infra/db/repositories/` 6종 (workspace, document, chunk, experiment, golden_set, checkpoint) + TC 41개
- [x] `infra/cache/parse_cache.py` + `embedding_cache.py` + TC 16개
- [x] `infra/fs/workspace_layout.py` — OS별 경로 + TC 16개
- [x] `infra/hardware/probe.py` — CPU/RAM/GPU + TC 6개
- [x] `domain/models/hardware.py` — SystemProfile/CPUInfo/GPUInfo

### 검증 ✅
- [x] 한글·이모지·공백 경로 fixture (txt 파서, workspace_layout, repository TC 등)
- [x] End-to-end smoke test: txt → chunk → embed → in-memory vector store → search 동작 확인

---

## Phase 2 — 도메인 서비스 ✅ 완료

오케스트레이션 + 비즈니스 로직.

- [x] `IndexingService` — 체크포인트 재개 (PARSED → CHUNKED → EMBEDDED), 부분 실패 isolation, 취소 토큰 + 진행률 reporter
- [x] `RetrievalService` — Dense (Sparse·Hybrid는 P1)
- [x] `EvaluationService` — 4지표, 검색 전용 모드 시 LLM 의존 지표 `null` 보고
- [x] `GoldenSetService` — `parse_csv()` (직접 입력 + CSV 업로드)
- [x] `HardwareProfiler` + `PresetRecommender` — RAM 기반 lite/balanced/quality 프리셋
- [x] `RAGPipeline` — `is_retrieval_only` 분기점, NullLLM 가드 포함
- [x] `TaskQueue` (asyncio.Semaphore, max_concurrent=1) + `CancellationToken` + `ProgressReporter`
- 합계: 서비스 37 TC, end-to-end smoke 동작 확인 (index → retrieve → evaluate)

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
