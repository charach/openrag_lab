# TODO — MVP 2-4주

> **범위**: P0만. P1·P2는 [docs/REQUIREMENTS_v4.md](docs/REQUIREMENTS_v4.md) §3·§7 참조.
> **작업 룰**: [docs/CLAUDE.md](docs/CLAUDE.md) 황금률 5가지 + 절대 금지 6항목 엄수.
> **수직 슬라이스 우선**: 한 phase 끝나야 다음으로.

---

## 🌙 다음 시작 지점 (2026-04-29 시점)

Phase 0·1·2·3·4 완료 — MVP 구현 완료.

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /Users/sukhwanyun/code/OpenRag_Lab
uv run pytest backend/tests/   # 333 passed
cd frontend && pnpm test       # 3 passed
pnpm e2e                       # 3 passed
pnpm build                     # 빌드 통과
```

다음 단계는 P1 (외부 LLM 어댑터, 시멘틱·문장 청킹, Sparse/Hybrid 검색, DOCX·HTML 파서, 매트릭스 평가).

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

## Phase 3 — API + UI ✅ 완료

REST/WS 계약 + 4개 화면.

### 백엔드 API ✅
- [x] `app/main.py` FastAPI 셋업 + DI (RuntimeFactories: embedder/vector_store/llm/judge 주입 가능)
- [x] REST 엔드포인트 — system / workspaces / documents / chunking / indexing / chat / golden-sets / experiments / config / tasks
- [x] WebSocket Hub (`app/ws/hub.py`) + `/ws` endpoint (subscribe/publish, exponential backoff 가이드 준수)
- [x] 에러 미들웨어 (`app/errors.py`) — 도메인 예외 → ERROR_CODES.md §12 매핑
- [x] `runtime.lock` 단일 인스턴스 보장 (`app/runtime_lock.py`)
- [ ] OpenAPI → 프런트 타입 자동 생성 (현재 수동 client.ts; P1 또는 Phase 4 자투리)

### 프런트 ✅
- [x] `AutoPilotWizard.tsx` — 프리셋 선택 → 워크스페이스 + 업로드 → 인덱싱 + WS 진행률
- [x] `ChatView.tsx` — 실험 선택, 질문, citation 청크 표시, 검색 전용 모드 배지
- [x] `ChunkingLab.tsx` — strategy/size/overlap 슬라이더 + 색상 오버레이 미리보기
- [x] `ExperimentMatrix.tsx` — RAGAS 4지표 표 + 그룹 막대그래프 (Recharts)
- [x] `useWebSocket` 훅 + Zustand `workspace` 스토어
- 합계: 백엔드 API 통합 TC 68개 (전체 321 passed) / 프런트 vitest 3개 / pnpm build 통과

검증 완료: ruff ✓ / mypy strict (94 files) ✓ / import-linter (2 contracts kept) ✓ / pytest **321 passed** / frontend typecheck + vitest + build ✓

---

## Phase 4 — 마무리 ✅ 완료

- [x] `/config/export`, `/config/import` — CONFIG_SCHEMA §7 핵심 룰 (UNKNOWN_FIELD 거부, OS 미스매치 경고, embedder/chunking dim 변경 시 archived)
- [x] 글로벌 `<OPENRAG_HOME>/settings.yaml` 로드 — `config/settings.py` (network proxy/tls/timeouts, 9 unit TC) + `_bootstrap_state` 시 부팅
- [x] E2E 시나리오 3개 (Playwright):
  1. Auto-Pilot — txt 업로드 → 인덱싱 → 검색 전용 채팅 ✓
  2. A/B — 두 청크 크기 인덱싱 → 두 fingerprint 다름 검증 ✓
  3. YAML 라운드트립 — export → 빈 워크스페이스 import → fingerprint 동일 ✓
- [x] CI 매트릭스: backend (macos-14·windows-latest·ubuntu-22.04) + frontend (3 OS) + e2e (ubuntu) — `.github/workflows/`
- [x] README "빠른 시작" 검증 (TEST_MODE=1로 부팅 → /system/profile + POST /workspaces 200/201 확인)
- [x] `OPENRAG_LAB_TEST_MODE=1`로 sentence-transformers/Chroma 없이도 부팅 — Playwright에서 사용
- 합계: 백엔드 333 + 프런트 3 + e2e 3 모두 그린

검증 완료: ruff ✓ / mypy strict (95 files) ✓ / import-linter (2 contracts kept) ✓ / pytest **333 passed** / vitest 3 / Playwright 3

---

## Phase 5 — 디자인 핸드오프 정렬 (2026-05-01~)

> Claude Design 핸드오프(`OpenRAG-Lab.html`)의 비주얼은 1차로 적용 완료 (`feat(frontend): Chanel-monochrome design system`).
> 그러나 디자인 목업이 보여주는 **상호작용·CRUD·CTA** 중 상당수는 백엔드 엔드포인트가 아직 없어 프런트만으로 구현이 불가능하다.
> 이 섹션은 **프런트 ↔ 백엔드 정합** 관점으로만 정리한다 — P1 카테고리(외부 LLM, 시멘틱 청킹 등)는 위 섹션 그대로.

### 5.1 워크스페이스 CRUD — 부분만 가능 ⚠️
디자인 목업: 헤더 드롭다운에서 New / Rename / Delete + 통계(docs/chunks/exp).

- **현재 가능**: `GET /workspaces`, `POST /workspaces`, `DELETE /workspaces/{id}` → 생성/삭제는 즉시 UI로 노출 가능
- [ ] **백엔드**: `PATCH /workspaces/{id}` (rename) — 현재 없음. `WorkspaceRepository.rename()` + 라우트 + TC
- [ ] **백엔드**: `GET /workspaces/{id}` 응답에 `stats` 포함 검증 (현재 응답 모델 확인 필요 — frontend `WorkspaceSummary.stats` 사용 중)
- [ ] **프런트**: 헤더 워크스페이스 드롭다운에 New/Rename/Delete 버튼 + confirm 모달 (디자인의 `confirmModal` 패턴)
- [ ] **프런트**: 삭제 시 활성 워크스페이스 자동 전환

### 5.2 Document Library 화면 — 신규 ⚠️
디자인 목업: 검색·포맷 필터·일괄 선택·rename·re-index·delete·upload (별도 라우트 `/library`).

- **현재 가능**: `GET /workspaces/{ws}/documents`, `POST .../documents` (업로드), `DELETE .../documents/{id}`
- [ ] **백엔드**: `PATCH /workspaces/{ws}/documents/{id}` (filename rename) — 현재 없음
- [ ] **백엔드**: `POST /workspaces/{ws}/documents/{id}/reindex` 또는 `force_reindex` 스코프 옵션 — 현재 워크스페이스 단위만 존재
- [ ] **백엔드**: 일괄 삭제 (`DELETE` body에 `ids[]`) 또는 클라이언트가 N회 호출 (정책 결정 필요)
- [ ] **프런트**: `screens/Library.tsx` 신규 + 라우트 + 헤더 nav 5번째 항목 추가
- [ ] **프런트**: 업로드 드롭존 (현재 Auto-Pilot에만 있음) 재사용 컴포넌트로 분리

### 5.3 Auto-Pilot 인덱싱 제어 — 백엔드는 있음, 프런트 미사용 ⚠️
디자인 목업: 인덱싱 중 Pause / Resume / Cancel 버튼 + per-file 진행 행.

- **현재 가능**: `POST /tasks/{task_id}/cancel` 존재 / WS로 진행률 수신
- [ ] **프런트**: Cancel 버튼 + confirm 모달 → `api.cancelTask()` 메서드 추가 (현재 `client.ts`에 미정의)
- [ ] **백엔드**: Pause/Resume — 체크포인트는 있지만 외부 RPC는 없음. **결정 필요**: pause를 별도 엔드포인트로 노출할지, cancel + 재개(resume = `force_reindex=false` 재호출) 패턴으로 끌고 갈지
- [ ] **프런트**: per-file 진행 행 — WS 메시지 스키마에 file_id별 stage/progress가 있는지 확인 후 와이어업

### 5.4 Chat — 다중 턴 영속성 + per-턴 CRUD 🚫 백엔드 부재
디자인 목업: 대화 히스토리, 턴 단위 edit / delete / copy / regenerate, regenerate 스트리밍 애니메이션, 실험별 thread 영속.

- **현재 한계**: `POST /workspaces/{ws}/chat`은 **단일 턴 stateless** — 응답에 `turn_id`는 있지만 저장·조회 API 없음
- [ ] **도메인/스키마**: `chat_turn` 테이블 (turn_id, experiment_id, question, answer, citations_json, latency_ms, tokens, created_at) — 현재 SQLite 스키마에 없음
- [ ] **백엔드**: `GET /workspaces/{ws}/experiments/{exp}/turns?cursor=` (페이지네이션)
- [ ] **백엔드**: `DELETE /workspaces/{ws}/turns/{turn_id}`
- [ ] **백엔드**: `POST /workspaces/{ws}/turns/{turn_id}/regenerate` (질문 그대로 재실행 + 새 turn_id) — 또는 클라이언트가 같은 question으로 `POST /chat` 재호출하는 패턴 채택
- [ ] **백엔드**: 스트리밍 응답 (SSE 또는 WS) — 현재 `stream` 파라미터는 client.ts에 정의되지만 서버에서 미구현
- [ ] **프런트**: 히스토리 렌더링, edit-and-resend, regenerate 애니메이션 (디자인의 blink 커서)

### 5.5 Chunking Lab → 새 실험 만들기 — 와이어업 누락 ⚠️
디자인 목업: 슬라이더로 만든 설정을 "Run as new experiment" 버튼 한 번에 실험으로 등록.

- **현재 가능**: `POST /workspaces/{ws}/index` (config 동봉) → 새 experiment_id 반환
- [ ] **프런트**: ChunkingLab에 "새 실험으로 실행" 버튼 + confirm 모달 → 현재 슬라이더 값으로 `startIndex` 호출
- [ ] **프런트**: 시작 후 Experiments 화면으로 라우팅 + WS 토픽 구독 안내

### 5.6 Experiment 배치 실행 (Matrix) — 백엔드 없음 (P1 표시됨)
디자인 목업: Define matrix 모달에서 embedder × chunking × retrieval × evaluator 토글 → 12 combos 실시간 표시 → Run batch → background session bar.

- **상태**: 위 "의도적으로 제외" §매트릭스 평가에 P1로 등록됨
- [ ] **백엔드** (P1): `POST /workspaces/{ws}/experiments/batch` — 입력 = 차원별 후보 배열, 출력 = task_id 1개로 묶이는 N개 experiments
- [ ] **백엔드** (P1): WS 토픽 `experiments.batch.{task_id}` — combo 단위 진행률 publish
- [ ] **프런트** (P1): MatrixDefinition UI + BatchSessionBar + cancel
- [ ] **프런트**: 단순 "한 실험 다시 실행" CTA는 5.5처럼 단발 indexing으로 즉시 가능

### 5.7 Experiment Detail Drawer — 신규 (백엔드 OK)
디자인 목업: 매트릭스 행 클릭 시 drawer로 상세(예: per-metric 분포, 골든셋 fail 샘플) 표시.

- **현재 가능**: `GET /workspaces/{ws}/experiments/{exp}` 존재
- [ ] **프런트**: ExperimentMatrix 행 클릭 → drawer 컴포넌트 + 응답 스키마 확장 검증 (per-metric raw 점수가 응답에 있는지 확인)
- [ ] **백엔드**: 응답에 골든셋별 question·정답 여부 배열이 빠져 있다면 추가 (현재 응답 모델 확인 필요)

### 5.8 Golden Set CRUD — 부분 ⚠️
디자인 목업: 페어 추가/수정/삭제, Import CSV, Export CSV.

- **현재 가능**: `POST /workspaces/{ws}/golden-sets` (직접 입력 + CSV 업로드)
- [ ] **백엔드**: per-pair PATCH/DELETE — 현재 없음 (`POST` 3종만)
- [ ] **백엔드**: `GET /workspaces/{ws}/golden-sets` 검증 — 1개는 있음, 응답 형태 확인 필요
- [ ] **백엔드**: `GET /workspaces/{ws}/golden-sets/{id}/export?format=csv`
- [ ] **프런트**: 골든셋 패널 — 현재 화면에 없음. ExperimentMatrix 또는 별도 라우트로 노출

### 5.9 Config Export / Import — UI 없음 ⚠️
디자인 목업: ExportModal 4종(Chat thread / Chunking / Library / Experiment), 포맷 토글(YAML/JSON/CSV), save-to picker, live preview.

- **현재 가능**: `GET /workspaces/{ws}/config/export`, `POST /workspaces/{ws}/config/import` 존재
- [ ] **프런트**: ExportModal 컴포넌트 — 4 컨텍스트 모두 같은 모달 재사용
- [ ] **결정**: save-to 경로 선택 — Electron/Tauri 없이 브라우저는 "Downloads"만 가능. **데스크톱 셸 도입 결정 전까지는 단순 다운로드로 축소**
- [ ] **프런트**: Import는 파일 업로드 → `/config/import` POST (이미 백엔드 있음, UI만 추가)
- [ ] **프런트**: Chat thread / Library / Experiment 컨텍스트는 5.4·5.2·5.6 의존 (그쪽이 먼저)

### 5.10 외부 LLM 인디케이터 — UI 없음
디자인 목업: 헤더에 "Anthropic · generation" pulse 표시 + 모델 다운로드 License 모달.

- **상태**: 외부 LLM 어댑터 자체가 P1 (위 섹션). 외부 호출 시점에 어떤 식으로 프런트에 알릴지 계약(WS 메시지 / 응답 필드) 결정 필요
- [ ] **백엔드** (P1): `ChatResponse.external_calls` 필드는 이미 존재 — 응답 도착 시점이 아니라 **요청 진행 중**에 알리려면 WS topic이 필요
- [ ] **프런트** (P1): Shell 헤더에 외부 호출 dot 노출 (`local only` ↔ `Anthropic · generation`)

### 5.11 다크/라이트 토글 — 프런트만으로 가능 ✅ 작은 작업
- [ ] **프런트**: Tweaks 패널 또는 헤더에 Theme 토글 — `data-theme` 속성만 swap (tokens.css는 이미 두 테마 지원)
- 사용자 선호 localStorage 영속

### 5.12 OpenAPI → 타입 자동 생성 — Phase 3에서 보류된 항목
- [ ] `openapi-typescript` 도입 → `frontend/src/api/types.ts` 자동 생성, 수동 `client.ts` 응답 타입과 정합 검증
- 5.x 작업에서 새 엔드포인트가 늘 때마다 손으로 동기화하는 부담을 줄이기 위해 **5.1 시작 전에 먼저 처리** 권장

### 우선순위 가이드

1. **5.12 OpenAPI 타입 자동화** (도구) — 다른 작업의 안전망
2. **5.1 워크스페이스 rename** (작은 백엔드 변경, UI 큰 효과)
3. **5.5 Chunking → 새 실험 CTA** (백엔드 변경 0)
4. **5.3 인덱싱 cancel UI** (백엔드 0)
5. **5.11 테마 토글** (백엔드 0, 작은 작업)
6. **5.2 Library 화면** + per-document API (rename/reindex)
7. **5.7 Experiment detail drawer**
8. **5.4 Chat 영속성** — 가장 큰 변경, 스키마 신설 필요. 별도 phase로 끊는 것을 권장
9. **5.6 / 5.10**은 P1과 동기화 (외부 LLM·매트릭스)

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
