# Architecture — OpenRAG-Lab

> 본 문서는 **현재 구현된 시스템**의 구조를 기술한다.
> 설계 의도와 결정 배경은 [docs/ARCHITECTURE_v3.md](docs/ARCHITECTURE_v3.md)에 있고, 본 문서는 그 결과물의 한 페이지 지도다.
> 충돌 시 본 문서가 코드 사실, `docs/ARCHITECTURE_v3.md`가 설계 의도다.

---

## 1. 한 줄 요약

로컬 우선 RAG 워크벤치. 도메인 코어를 어댑터/포트 패턴으로 격리해, **임베더·벡터스토어·LLM을 자유롭게 교체**하면서 같은 평가 파이프라인을 돌릴 수 있다.

```
┌──────────────┐  HTTP/WS   ┌─────────────────────────────────────┐
│ React SPA    │  ───────▶  │ FastAPI app (uvicorn)               │
│ 4 화면       │            │  ├── 9 REST 라우터 + /ws            │
│ Zustand      │            │  ├── TaskQueue (asyncio Semaphore)  │
│ Recharts     │            │  └── WebSocket Hub (pub/sub)        │
└──────────────┘            └─────────────────────────────────────┘
                                          │
                                          ▼
                            ┌─────────────────────────────────────┐
                            │ 도메인 서비스 (orchestration)       │
                            │ Indexing / Retrieval / Evaluation   │
                            │ RAGPipeline / GoldenSet / Preset    │
                            └─────────────────────────────────────┘
                                          │  Protocol 6종 (ports)
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                     Parser          Embedder       VectorStore
                     Chunker         LLM            EvaluatorJudge
                          │               │               │
                          ▼               ▼               ▼
                     adapters/      adapters/       adapters/
                     parsers/*      embedders/*     vector_stores/*
                                    llms/*          evaluators/*

infra/  : SQLite + 마이그레이션, 캐시 (parse/embedding), workspace_layout, hardware probe
config/ : 글로벌 settings.yaml 로더
```

---

## 2. 레이어 규칙

| 레이어 | 위치 | 의존 가능 | 절대 금지 |
|---|---|---|---|
| **domain** | `backend/src/openrag_lab/domain/` | 표준 라이브러리 + pydantic + numpy(타입만) | adapters / infra / app / 외부 lib |
| **adapters** | `.../adapters/` | domain (포트·모델·에러), 외부 lib | app |
| **infra** | `.../infra/` | domain | app |
| **app** | `.../app/` | 그 아래 모두 | 도메인 외부에서 도메인 비밀 노출 |

규칙은 [.importlinter](.importlinter)가 빌드마다 검증한다 (2 contracts kept).

> **OS 분기는 `infra/` 또는 `adapters/`에만**. 도메인 코드에 `sys.platform` / `os.name`이 등장하면 안 된다 ([docs/PLATFORM.md](docs/PLATFORM.md)).

---

## 3. 모듈 지도 (실제 파일)

### 3.1. 도메인 (`backend/src/openrag_lab/domain/`)

```
domain/
├── errors.py              # OpenRagError + 7 하위 예외 (ERROR_CODES.md §12 매핑)
├── models/                # frozen pydantic — 외부 의존 없음
│   ├── ids.py             # NewType: WorkspaceId, DocumentId, ChunkId, ...
│   ├── enums.py           # DocumentFormat, ChunkingStrategy, ...
│   ├── workspace.py       # Workspace, WorkspaceMeta
│   ├── document.py        # Document, ParsedDocument, ParsedPage
│   ├── chunk.py           # ChunkingConfig.cache_key() · Chunk · ChunkPreview
│   ├── embedding.py       # Embedding
│   ├── retrieval.py       # Query, RetrievalResult, RetrievedChunk
│   ├── experiment.py      # ExperimentConfig.fingerprint() · ExperimentResult · EvaluationScores
│   └── hardware.py        # SystemProfile · OSInfo · CPUInfo · RAMInfo · GPUInfo
├── ports/                 # Protocol — 어댑터 계약
│   ├── parser.py          # DocumentParser
│   ├── chunker.py         # Chunker (chunk + preview)
│   ├── embedder.py        # Embedder (embed_query / embed_documents)
│   ├── vector_store.py    # VectorStore (create_collection / upsert / search / delete / stats)
│   ├── llm.py             # LLM (generate / stream)
│   └── evaluator_judge.py # EvaluatorJudge (4 metrics)
└── services/              # 오케스트레이션 — 어댑터를 조립
    ├── indexing.py        # IndexingService — 체크포인트 PARSED→CHUNKED→EMBEDDED 재개, 부분 실패 isolation
    ├── retrieval.py       # RetrievalService — Dense (Sparse/Hybrid는 P1)
    ├── pipeline.py        # RAGPipeline — retrieval-only 분기
    ├── evaluation.py      # EvaluationService — 4지표, LLM 의존 지표는 retrieval-only 시 None
    ├── golden_set.py      # parse_csv() · GoldenPairCandidate
    ├── preset.py          # lite/balanced/quality 프리셋 + RAM 기반 추천
    ├── task_queue.py      # asyncio.Semaphore 기반, max_concurrent=1
    ├── cancellation.py    # CancellationToken (raise_if_cancelled)
    └── progress.py        # ProgressReporter Protocol (+ Null/Collecting 구현)
```

`ChunkingConfig.cache_key()`와 `ExperimentConfig.fingerprint()`는 둘 다 **결정적 sha256[:16]** — 같은 입력은 OS·프로세스·실행 시점과 무관하게 같은 키를 만든다. 이것이 캐시·비교·실험 ID의 기반이다.

### 3.2. 어댑터 (`adapters/`)

| 카테고리 | 라이트 (테스트·오프라인) | 헤비 (운영) |
|---|---|---|
| `parsers/` | `txt.py`, `markdown.py` | `pdf_pymupdf.py` |
| `chunkers/` | `fixed.py`, `recursive.py` (한국어 경계 포함) | — |
| `embedders/` | `fake.py` (sha256 기반 결정적) | `sentence_transformers_embedder.py` |
| `vector_stores/` | `in_memory.py` (브루트포스 NumPy) | `chroma.py` (PersistentClient) |
| `llms/` | `null.py` — `NullLLM`(refuse) + `EchoLLM`(deterministic) | (외부 LLM 4종은 P1) |
| `evaluators/` | `llm_judge.py` (RAGAS 4지표 프롬프트) | (모든 LLM 어댑터에 위임) |

테스트는 라이트 어댑터로, E2E·운영은 헤비 어댑터로 — 같은 포트를 구현하므로 도메인 코드는 동일.

### 3.3. 인프라 (`infra/`)

```
infra/
├── db/
│   ├── schema.sql                 # 7 테이블 — workspace · document · chunk · experiment · golden_set · golden_pair · indexing_checkpoint
│   ├── migrations.py              # schema_version 기반 idempotent
│   ├── sqlite.py                  # connect() — WAL + foreign_keys=ON + 마이그레이션 자동 적용
│   └── repositories/              # 6 repo, 모두 conn 주입
│       └── workspace_repo, document_repo, chunk_repo, experiment_repo, golden_set_repo, checkpoint_repo
├── cache/
│   ├── parse_cache.py             # (content_hash, parser_version) → ParsedDocument
│   └── embedding_cache.py         # (chunk_id, model_id, model_version) → Embedding
├── fs/
│   └── workspace_layout.py        # WorkspaceLayout, WorkspacePaths, resolve_openrag_home(), is_inside()
└── hardware/
    └── probe.py                   # OS·CPU·RAM·GPU(CUDA/Metal) 자동 탐지 → SystemProfile
```

**워크스페이스 레이아웃** ([docs/PLATFORM.md §2.2](docs/PLATFORM.md)):

```
<OPENRAG_HOME>/
├── settings.yaml          # 글로벌 (network proxy/tls/timeouts)
├── runtime.lock           # 단일 인스턴스 가드
├── models/                # 모델 캐시 (P1 다운로더와 함께)
├── logs/
└── workspaces/<ws_id>/
    ├── data.sqlite        # 워크스페이스 메타 (workspace 테이블 + 모든 도메인 테이블)
    ├── config.yaml        # YAML 익스포트의 결과물
    ├── documents/         # 업로드 원본 (path traversal 방어)
    ├── cache/parse/       # 파싱 결과 캐시
    ├── cache/embeddings/  # 임베딩 캐시
    └── vectors/           # ChromaDB persist dir (임베더 dim별로 컬렉션 분리)
```

### 3.4. 애플리케이션 (`app/`)

```
app/
├── main.py                # create_app() — FastAPI factory + lifespan + DI
├── state.py               # AppState (layout · profile · settings · factories · hub · task_queue · task_metadata)
├── dependencies.py        # FastAPI Depends(get_state)
├── runtime_lock.py        # 협조적 단일 인스턴스 (PLATFORM §5.4)
├── errors.py              # 도메인 예외 → HTTP 매핑 (ERROR_CODES.md §12)
├── services/
│   ├── workspace_registry.py  # 디렉토리 스캔 → 워크스페이스 목록·생성·삭제
│   ├── runtime.py             # RuntimeFactories — 어댑터 주입 포인트 (테스트 = Fake/InMemory, 운영 = ST/Chroma)
│   └── adapters_factory.py    # 포맷 → 파서/청커 디스패치
├── api/                   # 9 라우터
│   ├── system.py          # GET /system/profile · /system/presets
│   ├── workspaces.py      # CRUD + stats
│   ├── documents.py       # multipart 업로드 (path-safe) + 청킹 미리보기
│   ├── indexing.py        # POST /workspaces/{id}/index → 202
│   ├── chat.py            # POST /workspaces/{id}/chat (검색 전용 모드 지원)
│   ├── golden_sets.py     # CRUD + CSV 임포트
│   ├── experiments.py     # 목록·상세·평가 시작
│   ├── config.py          # YAML export/import (UNKNOWN_FIELD 거부, OS 미스매치 경고)
│   └── tasks.py           # GET /tasks/{id} · POST /tasks/{id}/cancel
└── ws/
    ├── hub.py             # WebSocketHub (subscribe / unsubscribe / publish + queue 백프레셔)
    └── endpoint.py        # /ws — JSON 명령 프로토콜
```

### 3.5. 프런트엔드 (`frontend/src/`)

```
src/
├── api/client.ts          # 타입 있는 fetch 래퍼 (vite proxy로 /api 프리픽스 제거)
├── hooks/useWebSocket.ts  # 지수 백오프 재연결 (1s → 30s)
├── stores/workspace.ts    # Zustand — activeWorkspaceId 만 보관 (서버 데이터 캐시 안 함)
├── screens/
│   ├── AutoPilotWizard.tsx   # 프리셋 → 업로드 → 인덱싱 + WS 진행률
│   ├── ChatView.tsx          # citation 청크 + retrieval-only 배지
│   ├── ChunkingLab.tsx       # strategy/size/overlap 슬라이더 + 색상 오버레이 (debounce 200ms)
│   └── ExperimentMatrix.tsx  # RAGAS 4지표 표 + Recharts 그룹 막대
└── App.tsx                # React Router 4 라우트
```

---

## 4. 핵심 데이터 흐름

### 4.1. 인덱싱

```
POST /workspaces/{id}/index
  → ConfigPayload 검증 (chunk_size ≤ embedder.max_tokens 등)
  → ExperimentRepository.add_pending(experiment_id, status=pending)
  → TaskQueue.enqueue(_job)             # 202 Accepted 즉시 응답
  └─ 비동기 _job:
       hub.publish(experiment:<id>, started)
       IndexingService.run(documents, config, chunking, token, progress, topic):
         for doc in documents:
           checkpoint? EMBEDDED → skip
           parser.parse → CHECKPOINT(PARSED)
           chunker.chunk → chunk_repo.add_many → CHECKPOINT(CHUNKED)
           embedder.embed_documents
           vector_store.upsert(collection=vectors_<model>_<dim>, items)
           CHECKPOINT(EMBEDDED)
       experiment_repo.save_result(status=completed)
       hub.publish(experiment:<id>, completed)
```

체크포인트 덕분에 작업이 중단돼도 다음 실행은 EMBEDDED인 문서를 건너뛴다. 부분 실패한 문서는 `failed`에 들어가고 다른 문서는 계속 진행된다.

### 4.2. 채팅 (Retrieve → Generate)

```
POST /workspaces/{id}/chat {experiment_id, question}
  → ExperimentRepository.get(experiment_id) — config 복원
  → build_runtime(embedder_id) — RuntimeFactories에서 어댑터 인스턴스화
  → RetrievalService.register_chunks(all_chunks_at_chunk_config_key)
  → RAGPipeline.answer(question):
       q_vec = embedder.embed_query(question)
       hits  = vector_store.search(collection, q_vec, top_k)
       chunks = lookup hits in chunk_repo
       if config.is_retrieval_only or llm is None:
         return RAGOutput(retrieval, answer=None)
       prompt = format_prompt(question, [hit.chunk.content])
       return RAGOutput(retrieval, answer=llm.generate(prompt))
  → 응답: {retrieval: {...chunks}, answer | mode: "retrieval_only"}
```

LLM 미설정 시 `mode: "retrieval_only"` 응답 — 프런트는 답변 패널 대신 배지를 보여준다.

### 4.3. 평가 (RAGAS 4지표)

```
POST /workspaces/{id}/experiments/{exp_id}/evaluate {golden_set_id, judge_llm_id}
  → 골든셋 pairs eager load (job 안전성)
  → TaskQueue.enqueue(_job)             # 202 Accepted
  └─ EvaluationService.evaluate(pairs):
       for pair in pairs:
         output = pipeline.answer(pair.question)
         context_precision   ← judge.score_context_precision(question, ctx)
         if pair.expected_answer: context_recall ← judge.score_context_recall(...)
         if not retrieval_only: faithfulness, answer_relevance ← judge ...
       → EvaluationScores(평균값)
     experiment_repo.save_result(scores=...)
```

검색 전용 모드에서는 LLM-의존 지표(`faithfulness`, `answer_relevance`)가 `null`로 보고된다 — 의도된 설계.

---

## 5. 동시성 / 에러 / 백프레셔

| 항목 | 정책 |
|---|---|
| **인덱싱** | 워크스페이스당 1개. 두 번째 호출은 409 `INDEXING_IN_PROGRESS`. |
| **채팅** | 동시 다수 (읽기). 같은 LLM 큐는 P1에서 정의 예정. |
| **평가** | TaskQueue.max_concurrent=1 (자원 격리). |
| **WebSocket 백프레셔** | 큐 100 초과 시 가장 오래된 메시지 폐기 (API §14.5). |
| **취소** | `POST /tasks/{id}/cancel` → CancellationToken — 단계 사이마다 raise_if_cancelled, 체크포인트 보존. |
| **단일 인스턴스** | `<OPENRAG_HOME>/runtime.lock` (pid + iso 시각). 살아 있는 lock은 거부, stale은 reclaim. |
| **에러 변환** | adapters/services는 `OpenRagError` 던짐 → `app/errors.py`가 envelope (`code`, `message`, `recoverable`, `details`)로 변환 + HTTP 상태 매핑. |

---

## 6. 확장 포인트

### 6.1. 새 어댑터 추가

1. `domain/ports/`에 Protocol 확인 (없으면 추가)
2. `adapters/<area>/<n>.py` 구현
3. `tests/integration/adapters/<area>/test_<n>.py` 통합 TC
4. `app/services/runtime.py`의 default_factories 또는 RuntimeFactories를 통해 주입
5. PLATFORM.md §9 어댑터 체크리스트 9항목 통과

### 6.2. 새 API 엔드포인트

1. [docs/API_SPEC_v4.md](docs/API_SPEC_v4.md) §3 인덱스에 등록
2. `app/api/<area>.py`에 라우터 추가
3. `app/main.py`의 `create_app()`에 `include_router`
4. `tests/integration/api/test_<area>.py` 통합 TC

### 6.3. 새 에러 코드

1. [docs/ERROR_CODES.md](docs/ERROR_CODES.md)에 등록 (HTTP 상태, recoverable, details 스키마, UI 분기)
2. 도메인 예외 클래스 매핑은 `app/errors.py:_status_for`
3. 단위 TC로 트리거 시나리오 검증

### 6.4. RuntimeFactories 주입 (테스트 / 임의 어댑터 조합)

```python
# 운영 (default)
state = AppState(layout=..., profile=..., factories=default_factories())

# 테스트 / 데모
factories = RuntimeFactories(
    embedder=lambda _id: FakeEmbedder(dim=32),
    vector_store=lambda _id, _path: shared_in_memory,
    llm=lambda _id: EchoLLM(),
    judge=lambda _id: LLMJudge(EchoLLM()),
)
state = AppState(layout=..., profile=..., factories=factories)

# 또는 환경변수로:
OPENRAG_LAB_TEST_MODE=1 uv run uvicorn openrag_lab.app.main:create_app --factory
```

---

## 7. 테스트 전략 (실제 수치)

| 레벨 | 위치 | 건수 |
|---|---|---|
| 단위 — 도메인 모델 결정성 | `tests/unit/models/` | cache_key/fingerprint TC |
| 단위 — 청커 / 어댑터 | `tests/unit/services/`, `unit/app/` | runtime_lock, errors, etc |
| 통합 — DB repository | `tests/integration/db/` | 41 TC |
| 통합 — 어댑터 (parser/embedder/vector_store/judge) | `tests/integration/adapters/` | parser·embedder·vector store·judge |
| 통합 — 도메인 서비스 | `tests/integration/services/` | indexing, retrieval pipeline, task_queue |
| 통합 — REST + WS | `tests/integration/api/` | 9 라우터 + WS 호환성 |
| 통합 — 글로벌 settings | `tests/unit/config/` | 9 TC |
| E2E — Playwright (브라우저) | `frontend/e2e/` | 3 시나리오 |

총합 **pytest 336 / vitest 3 / Playwright 3**. CI 매트릭스는 macOS 14, Windows latest, Ubuntu 22.04 모두 그린.

---

## 8. 결정 사항 요약 (v4 확정)

| 항목 | 결정 |
|---|---|
| 타깃 OS | macOS · Windows · Linux 동등 1급 (PLATFORM.md §1) |
| GPU 가속 우선순위 | CUDA > Metal > CPU. 자동 fallback (PLATFORM.md §3.3) |
| 외부 LLM | OpenRouter / Gemini / OpenAI / Anthropic — P1, 키 사전 등록 필수 |
| 검색 전용 모드 | P0 first-class (llm_id=None) |
| 임베더 차원 변경 | 응답에 `embedder_dim_changed` flag → 사용자 동의 후 archived 처리 |
| 동시 인덱싱 | 워크스페이스당 1개 (409 거부) |
| 매트릭스 평가 한도 | 50조합 (P1) |
| Bundle 모드 베이스 | `/api` 프리픽스 (vite dev proxy로 dev 환경 동등화) |

---

## 9. 더 읽을 것

| 문서 | 다루는 영역 |
|---|---|
| [docs/REQUIREMENTS_v4.md](docs/REQUIREMENTS_v4.md) | P0/P1/P2 무엇을 만드는가 |
| [docs/ARCHITECTURE_v3.md](docs/ARCHITECTURE_v3.md) | 본 문서의 설계 의도 (이유 포함) |
| [docs/API_SPEC_v4.md](docs/API_SPEC_v4.md) | REST + WebSocket 본문 스키마 |
| [docs/PLATFORM.md](docs/PLATFORM.md) | OS/경로/GPU/네트워크 단일 진실 공급원 |
| [docs/CONFIG_SCHEMA.md](docs/CONFIG_SCHEMA.md) | 워크스페이스 YAML 스키마 |
| [docs/ERROR_CODES.md](docs/ERROR_CODES.md) | 에러 코드 카탈로그 |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | 작업 컨벤션·금지사항 |
| [docs/CLAUDE.md](docs/CLAUDE.md) | AI 에이전트용 황금률 |
| [PROBLEM.md](PROBLEM.md) | 최종 체크에서 발견된 이슈 + 수정 내역 |
| [TODO.md](TODO.md) | Phase 0–4 진행 상황 + 다음 단계 |
