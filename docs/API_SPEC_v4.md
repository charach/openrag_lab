# OpenRAG-Lab API 명세서 (v4)

> **문서의 위치**: 설계서(SDD v3)의 §3 Application Layer를 외부 인터페이스 계약으로 풀어낸 문서.
> **짝 문서**: `PLATFORM.md` — OS·경로·GPU. `CONFIG_SCHEMA.md` — YAML 스키마. `ERROR_CODES.md` — 에러 카탈로그.
> **포맷**: 마크다운 단일 문서.
> **범위**: MVP(P0) 엔드포인트는 요청·응답 본문까지 상세히, P1·P2도 동일 깊이로 작성.
> **독자**: 프런트엔드 개발자, Claude Code, 외부 통합 개발자.
> **변경 이력**:
> - v2→v3: §4.1 SystemProfile에 `acceleration_backend`, `available_backends`, `os.arch`, `paths` 필드 추가 / §17에 OS 결정사항 정리.
> - v3→v4: 검색 전용 모드 응답 명세 / 외부 LLM 4종 키 등록 엔드포인트 (P1) / 임베더 변경 동의 플래그.

---

## 1. 설계 원칙

API 전반을 관통하는 6가지 원칙. 신규 엔드포인트 추가 시에도 이 원칙을 따른다.

1. **REST + WebSocket 분업**
   상태 변경·조회는 REST, 진행률·스트리밍은 WebSocket. 폴링은 사용하지 않는다.

2. **워크스페이스 스코프 우선**
   모든 데이터 조작 엔드포인트는 `/workspaces/{workspace_id}/...` 하위에 둔다. 시스템 전역은 `/system/*`, 작업 관리는 `/tasks/*`.

3. **장기 작업은 비동기**
   30초+ 작업(인덱싱, 평가, 모델 다운로드, 자동 골든셋 생성, 매트릭스 평가, Dockerfile 생성)은 항상 `202 Accepted + task_id`로 응답하고 WebSocket으로 진행률을 알린다.

4. **에러는 구조화**
   설계서 §9.3의 `error_code` 체계를 따른다. 프런트는 `error_code`로 분기 가능.

5. **외부 호출 명시**
   외부 LLM·모델 허브를 사용하는 모든 응답은 `external_calls: []` 필드를 포함하여 어떤 외부 호출이 발생했는지 사용자에게 표시 가능.

6. **결정적 재현**
   동일 입력에 대해 동일 결과를 보장하기 위해, 실험 관련 응답은 `config_fingerprint`를 함께 반환한다.

---

## 2. 공통 사양

### 2.1. 베이스 URL

| 환경 | 베이스 |
|---|---|
| Dev | `http://127.0.0.1:8000` |
| Bundle 모드 (단일 포트) | `http://127.0.0.1:<port>/api` |

WebSocket: `ws://127.0.0.1:<port>/ws`.

### 2.2. 인증

MVP는 단일 사용자, 로컬 머신 가정으로 인증을 두지 않는다.
- 기본적으로 `127.0.0.1`에만 바인딩.
- `--bind 0.0.0.0` 같은 비로컬 바인딩 시 토큰 인증 강제 (P1, §17.1 참조).

### 2.3. 공통 응답 형식

성공 응답은 자원 객체를 그대로 반환한다 (envelope 없음).

에러 응답은 항상 다음 구조:

```json
{
  "error": {
    "code": "PARSE_ENCRYPTED_PDF",
    "message": "암호화된 PDF는 처리할 수 없습니다.",
    "recoverable": false,
    "details": { "document_id": "doc_abc123" }
  }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `code` | string | 안정된 식별자. 프런트 분기에 사용. |
| `message` | string | 사용자에게 표시 가능한 메시지. |
| `recoverable` | bool | 재시도 가능 여부. |
| `details` | object | 컨텍스트별 추가 정보. 옵셔널. |

### 2.4. HTTP 상태 코드

| 코드 | 사용처 |
|---|---|
| 200 | 즉시 완료된 GET/POST. |
| 201 | 자원 생성 완료. |
| 202 | 비동기 작업 접수. 본문에 `task_id`. |
| 204 | DELETE 성공, 본문 없음. |
| 400 | 클라이언트 입력 오류. |
| 404 | 자원 없음. |
| 409 | 충돌 (동시성, 중복). |
| 422 | 입력 형식은 맞으나 의미 오류. |
| 500 | 서버 내부 오류. |
| 503 | 외부 의존성 실패. |

### 2.5. 리소스 ID 규약

| 리소스 | 접두 | 예시 |
|---|---|---|
| Workspace | `ws_` | `ws_a1b2c3` |
| Document | `doc_` | `doc_xyz789` |
| Experiment | `exp_` | `exp_42abcd` |
| GoldenSet | `gs_` | `gs_fedcba` |
| GoldenPair | `pair_` | `pair_001` |
| Task | `task_` | `task_zzz000` |
| ChatTurn | `turn_` | `turn_aabbcc` |
| Model | `model_` | `model_bge_small` |

### 2.6. 페이지네이션

리스트 엔드포인트는 커서 기반:

```
GET /workspaces/{id}/documents?cursor=eyJ...&limit=50
```

응답:

```json
{
  "items": [...],
  "next_cursor": "eyJ...",
  "total": 142
}
```

---

## 3. 엔드포인트 인덱스

### 3.1. MVP (P0)

| 메서드 | 경로 | 용도 | 섹션 |
|---|---|---|---|
| GET | `/system/profile` | 하드웨어 프로파일 | §4.1 |
| GET | `/system/presets` | 추천 프리셋 | §4.2 |
| GET | `/workspaces` | 워크스페이스 목록 | §5.1 |
| POST | `/workspaces` | 워크스페이스 생성 | §5.2 |
| GET | `/workspaces/{id}` | 상세 | §5.3 |
| DELETE | `/workspaces/{id}` | 삭제 | §5.4 |
| GET | `/workspaces/{id}/documents` | 문서 목록 | §6.1 |
| POST | `/workspaces/{id}/documents` | 업로드 | §6.2 |
| DELETE | `/workspaces/{id}/documents/{doc_id}` | 삭제 | §6.3 |
| POST | `/workspaces/{id}/chunking/preview` | 청킹 미리보기 | §7.1 |
| POST | `/workspaces/{id}/index` | 인덱싱 시작 | §8.1 |
| GET | `/workspaces/{id}/experiments` | 실험 목록 | §11.1 |
| GET | `/workspaces/{id}/experiments/{exp_id}` | 실험 상세 | §11.2 |
| POST | `/workspaces/{id}/chat` | 채팅 | §9.1 |
| GET | `/workspaces/{id}/golden-sets` | 골든 셋 목록 | §10.1 |
| POST | `/workspaces/{id}/golden-sets` | 골든 셋 생성 | §10.2 |
| POST | `/workspaces/{id}/golden-sets/{gs_id}/pairs` | 평가 쌍 추가 | §10.3 |
| POST | `/workspaces/{id}/golden-sets/{gs_id}/pairs/import` | CSV 업로드 | §10.4 |
| POST | `/workspaces/{id}/experiments/{exp_id}/evaluate` | 평가 실행 | §11.3 |
| GET | `/workspaces/{id}/config/export` | YAML 내보내기 | §12.1 |
| POST | `/workspaces/{id}/config/import` | YAML 가져오기 | §12.2 |
| POST | `/tasks/{task_id}/cancel` | 작업 취소 | §13.2 |
| GET | `/tasks/{task_id}` | 작업 상태 | §13.1 |
| WS | `/ws` | 진행률·스트리밍 | §14 |

### 3.2. P1

| 메서드 | 경로 | 용도 | 섹션 |
|---|---|---|---|
| GET | `/system/external-providers` | 외부 LLM 제공자 키 상태 | §15.0.1 |
| POST | `/system/external-providers/{provider_id}/key` | 키 등록 | §15.0.2 |
| DELETE | `/system/external-providers/{provider_id}/key` | 키 제거 | §15.0.3 |
| POST | `/system/external-providers/{provider_id}/validate` | 키 재검증 | §15.0.4 |
| GET | `/system/models` | 모델 카탈로그 | §15.1 |
| GET | `/system/models/{model_id}` | 모델 상세 | §15.2 |
| POST | `/system/models/{model_id}/download` | 다운로드 | §15.3 |
| DELETE | `/system/models/{model_id}` | 캐시 제거 | §15.4 |
| POST | `/workspaces/{id}/golden-sets/{gs_id}/auto-generate` | 자동 골든 셋 | §15.5 |
| POST | `/workspaces/{id}/experiments/batch` | 매트릭스 평가 | §15.6 |
| POST | `/workspaces/{id}/serve` | RAG API 서버 시작 | §15.7 |
| GET | `/workspaces/{id}/serve` | 서빙 상태 | §15.8 |
| DELETE | `/workspaces/{id}/serve` | 서버 중지 | §15.9 |
| GET | `/workspaces/{id}/serve/openapi.json` | 서빙 스펙 | §15.10 |
| POST | `/auth/token` | 토큰 발급 (비로컬 바인딩 시) | §17.1 |

### 3.3. P2

| 메서드 | 경로 | 용도 | 섹션 |
|---|---|---|---|
| POST | `/workspaces/{id}/export/dockerfile` | Dockerfile 생성 | §16.1 |
| POST | `/workspaces/{id}/share/export` | 공유 패키지 | §16.2 |
| POST | `/workspaces/import` | 공유 패키지 복원 | §16.3 |

---

## 4. 시스템 엔드포인트 (P0)

### 4.1. `GET /system/profile`

하드웨어 프로파일 조회. 시작 시 한 번 호출 후 캐시 권장.

**응답 200**

```json
{
  "cpu": {
    "cores": 8,
    "threads": 16,
    "model": "Apple M2 Pro"
  },
  "ram": {
    "total_gb": 32,
    "available_gb": 24
  },
  "gpu": {
    "available": true,
    "vendor": "apple",
    "name": "M2 Pro GPU",
    "vram_gb": null,
    "compute_capability": null,
    "acceleration_backend": "metal",
    "available_backends": ["metal", "cpu"]
  },
  "os": {
    "platform": "darwin",
    "version": "14.5",
    "arch": "arm64"
  },
  "paths": {
    "openrag_home": "/Users/jisu/Library/Application Support/OpenRAG-Lab",
    "models_dir": "/Users/jisu/Library/Application Support/OpenRAG-Lab/models",
    "workspaces_dir": "/Users/jisu/Library/Application Support/OpenRAG-Lab/workspaces"
  },
  "warnings": []
}
```

**필드 설명**
- `gpu.vendor`: `nvidia` | `amd` | `apple` | `intel` | `null`.
- `gpu.vram_gb`: 통합 메모리 환경(Apple Silicon)에서는 `null`.
- `gpu.acceleration_backend`: 현재 채택된 백엔드. `cuda` | `metal` | `rocm` | `xpu` | `directml` | `cpu`. 선택 로직은 `PLATFORM.md` §3.3.
- `gpu.available_backends`: 시스템에서 사용 가능한 백엔드 목록 (검증 후 결정).
- `os.platform`: `darwin` | `windows` | `linux`.
- `os.arch`: `x86_64` | `arm64`.
- `paths.*`: 절대 경로. OS별로 다름 (`PLATFORM.md` §2.1). 환경변수 `OPENRAG_HOME`으로 재정의 가능.
- `warnings`: 예) `["GPU_DRIVER_OUTDATED", "RAM_LOW", "BACKEND_FALLBACK_TO_CPU", "PATH_LONG_NOT_ENABLED"]`. 사용자에게 표시.

`gpu.available: false`이면 프런트는 정확도 우선 프리셋을 비활성화한다.

### 4.2. `GET /system/presets`

하드웨어 프로파일에 기반한 추천 프리셋. 내부적으로 §4.1을 참조하므로 추가 호출 불필요.

**응답 200**

```json
{
  "presets": [
    {
      "id": "speed",
      "name": "속도 우선",
      "available": true,
      "config": {
        "embedder_id": "all-MiniLM-L6-v2",
        "chunking": {
          "strategy": "fixed",
          "chunk_size": 256,
          "chunk_overlap": 32
        },
        "retrieval_strategy": "dense",
        "top_k": 3,
        "llm_id": "local:tinyllama-1.1b-q4"
      },
      "rationale": "8GB 미만 GPU 또는 CPU 환경에서 빠른 응답."
    },
    {
      "id": "balanced",
      "name": "밸런스",
      "available": true,
      "config": { "...": "..." },
      "rationale": "일반적인 PC 환경에서 정확도와 속도의 균형."
    },
    {
      "id": "accuracy",
      "name": "정확도 우선",
      "available": false,
      "reason_unavailable": "VRAM 8GB 이상 필요",
      "config": { "...": "..." }
    }
  ]
}
```

---

## 5. 워크스페이스 (P0)

### 5.1. `GET /workspaces`

**쿼리 파라미터**: `cursor`, `limit`.

**응답 200**

```json
{
  "items": [
    {
      "id": "ws_a1b2c3",
      "name": "변호사 자료실",
      "created_at": "2026-04-27T10:00:00Z",
      "stats": {
        "document_count": 12,
        "chunk_count": 384,
        "experiment_count": 3
      }
    }
  ],
  "next_cursor": null
}
```

### 5.2. `POST /workspaces`

**요청**

```json
{
  "name": "변호사 자료실",
  "preset_id": "balanced"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `name` | ✅ | 1~200자. |
| `preset_id` |  | 지정 시 해당 프리셋의 config 자동 적용. 없으면 빈 config로 생성. |

**응답 201**

```json
{
  "id": "ws_a1b2c3",
  "name": "변호사 자료실",
  "created_at": "2026-04-27T10:00:00Z",
  "config": {
    "embedder_id": "BAAI/bge-small-en-v1.5",
    "chunking": { "strategy": "recursive", "chunk_size": 512, "chunk_overlap": 64 },
    "retrieval_strategy": "dense",
    "top_k": 5,
    "llm_id": null
  },
  "stats": {
    "document_count": 0,
    "chunk_count": 0,
    "experiment_count": 0
  }
}
```

### 5.3. `GET /workspaces/{workspace_id}`

§5.2 응답 구조와 동일. 추가로 활성 작업 정보가 있을 경우 `active_task` 필드 포함.

```json
{
  "id": "ws_a1b2c3",
  "name": "변호사 자료실",
  "created_at": "...",
  "config": { "...": "..." },
  "stats": { "...": "..." },
  "active_task": {
    "task_id": "task_zzz000",
    "kind": "indexing",
    "started_at": "..."
  }
}
```

### 5.4. `DELETE /workspaces/{workspace_id}`

워크스페이스 디렉토리·SQLite·벡터 데이터를 영구 삭제.

**응답 204** (본문 없음)

**응답 409**: 진행 중인 작업이 있는 경우.

```json
{
  "error": {
    "code": "WORKSPACE_BUSY",
    "message": "진행 중인 작업이 있어 삭제할 수 없습니다.",
    "recoverable": true,
    "details": { "running_task_id": "task_yyy999" }
  }
}
```

---

## 6. 문서 (P0)

### 6.1. `GET /workspaces/{id}/documents`

**쿼리**: `cursor`, `limit`, `format` (필터, 예: `pdf`).

**응답 200**

```json
{
  "items": [
    {
      "id": "doc_xyz789",
      "filename": "file1.pdf",
      "format": "pdf",
      "size_bytes": 1048576,
      "content_hash": "sha256:abc...",
      "added_at": "2026-04-27T10:05:00Z",
      "indexing_status": "indexed"
    }
  ],
  "next_cursor": null
}
```

`indexing_status`: `not_indexed` | `indexing` | `indexed` | `failed`.

### 6.2. `POST /workspaces/{id}/documents`

`multipart/form-data`로 다중 파일 업로드.

**요청**

```
Content-Type: multipart/form-data
files: file1.pdf
files: file2.md
```

**응답 201**

```json
{
  "uploaded": [
    {
      "id": "doc_xyz789",
      "filename": "file1.pdf",
      "size_bytes": 1048576,
      "format": "pdf",
      "content_hash": "sha256:abc...",
      "added_at": "2026-04-27T10:05:00Z",
      "indexing_status": "not_indexed"
    }
  ],
  "skipped": [
    {
      "filename": "file2.md",
      "reason": "DUPLICATE_CONTENT_HASH",
      "existing_id": "doc_old111"
    }
  ],
  "failed": [
    {
      "filename": "broken.pdf",
      "error": {
        "code": "PARSE_ENCRYPTED_PDF",
        "message": "암호화된 PDF는 처리할 수 없습니다.",
        "recoverable": false
      }
    }
  ]
}
```

**중요**: 부분 실패 시에도 201을 반환한다 (설계서 §9.2-3 부분 실패 원칙). 클라이언트는 세 배열을 모두 검사해야 한다.

### 6.3. `DELETE /workspaces/{id}/documents/{doc_id}`

해당 문서의 청크와 벡터를 모두 삭제.

**응답 204**
**응답 409**: 인덱싱 진행 중.

---

## 7. 청킹 미리보기 (P0)

### 7.1. `POST /workspaces/{id}/chunking/preview`

청킹 실험실의 핵심. 슬라이더 변경 시마다 호출되므로 **1초 이내 응답이 필수**.

**요청**

```json
{
  "document_id": "doc_xyz789",
  "config": {
    "strategy": "recursive",
    "chunk_size": 512,
    "chunk_overlap": 64,
    "extra": {}
  },
  "max_chunks": 50
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `document_id` |  | 없으면 워크스페이스 첫 번째 문서. |
| `config.strategy` | ✅ | `fixed` \| `recursive` \| `sentence`(P1) \| `semantic`(P1). |
| `config.chunk_size` | ✅ | 32~4096 토큰. |
| `config.chunk_overlap` |  | 0~`chunk_size`/2. |
| `config.extra` |  | 전략별 추가 파라미터. |
| `max_chunks` |  | 1~200, 기본 50. |

**응답 200**

```json
{
  "config_key": "recursive-512-64-...",
  "chunks": [
    {
      "sequence": 0,
      "content": "...",
      "token_count": 487,
      "start_offset": 0,
      "end_offset": 1893,
      "page": 1,
      "color_hint": "#FFE5A0"
    }
  ],
  "stats": {
    "total_chunks_estimated": 142,
    "avg_token_count": 478,
    "min_token_count": 102,
    "max_token_count": 512
  }
}
```

**구현 노트**:
- `total_chunks_estimated`는 전체를 청크하지 않고 첫 N페이지로 외삽한 추정치.
- `color_hint`는 시각화용 결정적 색상. `(sequence * golden_ratio) mod 360`을 HSL로 변환하는 식의 단순 매핑 권장.

---

## 8. 인덱싱 (P0)

### 8.1. `POST /workspaces/{id}/index`

**요청**

```json
{
  "config": {
    "embedder_id": "BAAI/bge-small-en-v1.5",
    "chunking": {
      "strategy": "recursive",
      "chunk_size": 512,
      "chunk_overlap": 64
    },
    "retrieval_strategy": "dense",
    "top_k": 5,
    "reranker_id": null,
    "llm_id": "local:llama-3-8b-q4"
  },
  "document_ids": null,
  "force_reindex": false
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `config` | ✅ | `ExperimentConfig`. 워크스페이스의 현재 config와 다르면 새 실험으로 기록. |
| `document_ids` |  | `null`이면 전체. 부분 인덱싱 시 ID 배열. |
| `force_reindex` |  | `true`면 임베딩 캐시 무시. |

**응답 202**

```json
{
  "task_id": "task_zzz000",
  "experiment_id": "exp_42abcd",
  "config_fingerprint": "fp_a1b2c3",
  "estimated_duration_seconds": 180,
  "websocket_topic": "experiment:exp_42abcd",
  "external_calls": []
}
```

**응답 409**: 이미 인덱싱이 진행 중인 경우.

```json
{
  "error": {
    "code": "INDEXING_IN_PROGRESS",
    "message": "이미 인덱싱이 진행 중입니다.",
    "recoverable": true,
    "details": { "running_task_id": "task_yyy999" }
  }
}
```

**응답 422**: 의미 오류. 예: `chunk_size`가 임베더의 `max_tokens`를 초과.

```json
{
  "error": {
    "code": "CHUNK_SIZE_EXCEEDS_EMBEDDER_LIMIT",
    "message": "청크 크기(2048)가 임베더 'all-MiniLM-L6-v2'의 최대 토큰(512)을 초과합니다.",
    "recoverable": false,
    "details": { "chunk_size": 2048, "embedder_max_tokens": 512 }
  }
}
```

### 8.2. WebSocket 진행률

`websocket_topic`을 구독하면 다음 메시지가 도착 (§14 참조).

```json
{ "topic": "experiment:exp_42abcd", "type": "started",
  "task_id": "task_zzz000", "total_documents": 12 }

{ "topic": "experiment:exp_42abcd", "type": "progress",
  "stage": "parsing",
  "document_id": "doc_xyz789",
  "completed": 1, "total": 12 }

{ "topic": "experiment:exp_42abcd", "type": "progress",
  "stage": "embedding",
  "document_id": "doc_xyz789",
  "embedded": 80, "total": 142,
  "tokens_per_sec": 1240 }

{ "topic": "experiment:exp_42abcd", "type": "document_skipped",
  "document_id": "doc_old111", "reason": "cache_hit" }

{ "topic": "experiment:exp_42abcd", "type": "document_failed",
  "document_id": "doc_bad",
  "error": { "code": "PARSE_ENCRYPTED_PDF", "message": "..." } }

{ "topic": "experiment:exp_42abcd", "type": "completed",
  "task_id": "task_zzz000",
  "experiment_id": "exp_42abcd",
  "duration_seconds": 175,
  "summary": { "indexed": 11, "skipped": 0, "failed": 1 } }
```

---

## 9. 채팅 (P0)

### 9.1. `POST /workspaces/{id}/chat`

검색 결과는 즉시 동기 반환되고, 답변 토큰은 WebSocket으로 스트리밍한다.

**요청**

```json
{
  "experiment_id": "exp_42abcd",
  "question": "갱신 거절 사유로 인정된 판례가 있나?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "stream": true
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `experiment_id` | ✅ | 어느 실험 설정으로 답할지. |
| `question` | ✅ | 1자 이상. |
| `history` |  | 멀티턴 컨텍스트. 최대 20턴 권장. |
| `stream` |  | `false`면 답변 완성 후 한 번에 응답. |

**응답 200 (stream=true)**

```json
{
  "turn_id": "turn_aabbcc",
  "websocket_topic": "chat:turn_aabbcc",
  "retrieval": {
    "latency_ms": 87,
    "chunks": [
      {
        "chunk_id": "chunk_111",
        "document_id": "doc_xyz789",
        "filename": "판례A.pdf",
        "page": 42,
        "content": "...",
        "score": 0.91,
        "rank": 1
      }
    ]
  },
  "external_calls": []
}
```

**응답 200 (stream=false)**

위 응답에 다음 필드가 추가된다.

```json
{
  "turn_id": "turn_aabbcc",
  "retrieval": { "...": "..." },
  "answer": "이번 사례에서는...",
  "citations": [
    { "chunk_id": "chunk_111", "spans_in_answer": [[0, 12], [45, 78]] }
  ],
  "tokens_generated": 234,
  "duration_ms": 4200,
  "external_calls": []
}
```

`spans_in_answer`는 P1로 미루는 것이 권장된다 (§17.5). MVP에서는 청크 인용 목록만으로 충분.

#### 9.1.1. 검색 전용 모드 (Retrieval-Only Mode) 응답

해당 워크스페이스의 `experiment.config.llm_id`가 `null`이면 **검색 전용 모드**로 동작한다 (컨셉 §3.3.4).

이 경우 응답:
- `retrieval` 필드는 정상적으로 채워짐.
- `answer`는 `null`.
- `citations`는 빈 배열 또는 `null`.
- `tokens_generated`, `duration_ms` (생성 단계)는 모두 `null`.
- `mode: "retrieval_only"` 필드가 명시적으로 포함됨.
- WebSocket 토큰 스트림은 발생하지 않음 (`websocket_topic`도 응답에 포함되지 않음).

```json
{
  "turn_id": "turn_aabbcc",
  "mode": "retrieval_only",
  "retrieval": {
    "latency_ms": 87,
    "chunks": [ { "chunk_id": "chunk_111", "filename": "판례A.pdf", "page": 42, "content": "...", "score": 0.91, "rank": 1 } ]
  },
  "answer": null,
  "citations": null,
  "external_calls": []
}
```

프런트는 `mode === "retrieval_only"`일 때 답변 영역 대신 "검색 전용 모드" 배지와 함께 청크 목록만 표시한다.

### 9.2. WebSocket 토큰 스트림

```json
{ "topic": "chat:turn_aabbcc", "type": "token", "delta": "이번 " }
{ "topic": "chat:turn_aabbcc", "type": "token", "delta": "사례에서는 " }
...
{ "topic": "chat:turn_aabbcc", "type": "completed",
  "full_answer": "...",
  "citations": [
    { "chunk_id": "chunk_111", "spans_in_answer": [[0, 12]] }
  ],
  "tokens_generated": 234,
  "duration_ms": 4200 }
```

---

## 10. 골든 셋 (P0)

### 10.1. `GET /workspaces/{id}/golden-sets`

**응답 200**

```json
{
  "items": [
    {
      "id": "gs_fedcba",
      "name": "MVP 검증용 50문항",
      "pair_count": 50,
      "created_at": "2026-04-27T11:00:00Z"
    }
  ]
}
```

### 10.2. `POST /workspaces/{id}/golden-sets`

**요청**

```json
{ "name": "MVP 검증용 50문항" }
```

**응답 201**

```json
{
  "id": "gs_fedcba",
  "name": "MVP 검증용 50문항",
  "pair_count": 0,
  "created_at": "..."
}
```

### 10.3. `POST /workspaces/{id}/golden-sets/{gs_id}/pairs`

배열로 일괄 추가.

**요청**

```json
{
  "pairs": [
    {
      "question": "갱신 거절 사유 인정 판례는?",
      "expected_answer": "대법원 2019다XXX 판결...",
      "expected_chunk_ids": []
    }
  ]
}
```

**응답 201**

```json
{
  "added": 1,
  "skipped": 0,
  "ids": ["pair_001"]
}
```

### 10.4. `POST /workspaces/{id}/golden-sets/{gs_id}/pairs/import`

CSV 일괄 업로드. multipart, 헤더는 `question,expected_answer,expected_chunk_ids` (마지막은 JSON 배열).

**응답 201**

```json
{
  "added": 47,
  "skipped": 3,
  "errors": [
    { "row": 5, "reason": "MISSING_QUESTION" }
  ]
}
```

---

## 11. 실험 (P0)

### 11.1. `GET /workspaces/{id}/experiments`

**응답 200**

```json
{
  "items": [
    {
      "id": "exp_42abcd",
      "config_fingerprint": "fp_a1b2c3",
      "status": "completed",
      "started_at": "...",
      "completed_at": "...",
      "scores": {
        "faithfulness": 0.86,
        "answer_relevance": 0.91,
        "context_precision": 0.78,
        "context_recall": 0.82
      }
    }
  ],
  "next_cursor": null
}
```

`status`: `pending` | `running` | `completed` | `failed` | `cancelled`.

### 11.2. `GET /workspaces/{id}/experiments/{exp_id}`

**응답 200**

```json
{
  "id": "exp_42abcd",
  "config": {
    "embedder_id": "BAAI/bge-small-en-v1.5",
    "chunking": { "strategy": "recursive", "chunk_size": 512, "chunk_overlap": 64 },
    "retrieval_strategy": "dense",
    "top_k": 5,
    "llm_id": "local:llama-3-8b-q4"
  },
  "config_fingerprint": "fp_a1b2c3",
  "status": "completed",
  "started_at": "...",
  "completed_at": "...",
  "scores": {
    "faithfulness": 0.86,
    "answer_relevance": 0.91,
    "context_precision": 0.78,
    "context_recall": 0.82
  },
  "profile": {
    "total_latency_ms": 4250,
    "stages": {
      "parsing_ms": 800,
      "chunking_ms": 120,
      "embedding_ms": 2400,
      "retrieval_ms": 87,
      "generation_ms": 843
    },
    "peak_memory_mb": 2480,
    "peak_vram_mb": 4096
  },
  "pair_results": [
    {
      "pair_id": "pair_001",
      "question": "갱신 거절 사유 인정 판례는?",
      "generated_answer": "...",
      "scores": {
        "faithfulness": {
          "value": 0.92,
          "rationale": "답변의 모든 주장이 검색된 컨텍스트에 명시적으로 등장."
        },
        "answer_relevance": {
          "value": 0.95,
          "rationale": "..."
        }
      }
    }
  ]
}
```

A/B 비교는 두 실험을 각각 GET 후 프런트에서 합쳐 차트화한다.

### 11.3. `POST /workspaces/{id}/experiments/{exp_id}/evaluate`

**요청**

```json
{
  "golden_set_id": "gs_fedcba",
  "metrics": ["faithfulness", "answer_relevance", "context_precision", "context_recall"],
  "judge_llm_id": "local:llama-3-8b-q4"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `golden_set_id` | ✅ |  |
| `metrics` |  | 기본 4개 모두. |
| `judge_llm_id` |  | 평가용 LLM. 기본은 워크스페이스의 `llm_id`. 외부 LLM 사용 시 `external_calls`에 명시. |

**응답 202**

```json
{
  "task_id": "task_eval_001",
  "websocket_topic": "evaluation:exp_42abcd",
  "estimated_duration_seconds": 240,
  "external_calls": []
}
```

**WebSocket 메시지**

```json
{ "topic": "evaluation:exp_42abcd", "type": "started", "total_pairs": 50 }

{ "topic": "evaluation:exp_42abcd", "type": "pair_completed",
  "pair_id": "pair_001",
  "scores": {
    "faithfulness": { "value": 0.89, "rationale": "..." }
  },
  "completed": 1, "total": 50 }

{ "topic": "evaluation:exp_42abcd", "type": "completed",
  "experiment_id": "exp_42abcd",
  "aggregate": {
    "faithfulness": 0.86,
    "answer_relevance": 0.91,
    "context_precision": 0.78,
    "context_recall": 0.82
  },
  "duration_seconds": 232 }
```

---

## 12. 설정 익스포트/임포트 (P0)

### 12.1. `GET /workspaces/{id}/config/export`

**쿼리**: `format=yaml`(기본) | `json`.

**응답 200** (YAML)

```yaml
# Content-Type: application/yaml
version: "1"
workspace:
  name: "변호사 자료실"
config:
  embedder_id: "BAAI/bge-small-en-v1.5"
  chunking:
    strategy: "recursive"
    chunk_size: 512
    chunk_overlap: 64
  retrieval_strategy: "dense"
  top_k: 5
  llm_id: "local:llama-3-8b-q4"
fingerprint: "fp_a1b2c3"
exported_at: "2026-04-27T11:00:00Z"
```

### 12.2. `POST /workspaces/{id}/config/import`

multipart 또는 본문에 YAML 전송.

**요청** (Content-Type: `application/yaml` 또는 `application/json`)

§12.1과 동일한 구조.

**응답 200**

```json
{
  "applied": true,
  "config_changed": true,
  "requires_reindex": true,
  "embedder_changed": true,
  "embedder_dim_changed": true,
  "previous_experiments_will_be_archived": 3,
  "fingerprint": "fp_x9y8z7"
}
```

| 필드 | 의미 |
|---|---|
| `requires_reindex` | 청킹·임베더 변경으로 재인덱싱 필요. |
| `embedder_changed` | 임베더 ID가 바뀜. |
| `embedder_dim_changed` | 차원이 다름. ChromaDB 컬렉션이 자동으로 분리됨. |
| `previous_experiments_will_be_archived` | 차원 변경 시 보존되는 이전 실험 수. |

**임베더 차원 변경 시 동작** (설계서 §13-4):
- 응답이 `embedder_dim_changed: true`이면 프런트는 다음 모달을 표시:
  > "임베더가 차원이 다른 모델로 변경되었습니다. 전체 재인덱싱이 필요합니다 (예상 시간 X분).
  > 기존 실험 결과 N개는 archived 상태로 보존되어 비교에 사용할 수 있습니다.
  > 계속하시겠습니까? [취소] [동의하고 재인덱싱]"
- 사용자가 동의 시 `/index` 호출. 새 ChromaDB 컬렉션은 차원별로 자동 격리.
- 사용자가 취소 시 설정은 적용되지 않음 (이전 설정으로 롤백).

---

## 13. 작업 관리 (P0)

### 13.1. `GET /tasks/{task_id}`

**응답 200**

```json
{
  "id": "task_zzz000",
  "kind": "indexing",
  "status": "running",
  "progress": {
    "stage": "embedding",
    "completed": 80,
    "total": 142,
    "ratio": 0.56
  },
  "started_at": "...",
  "estimated_completion_at": "...",
  "result_ref": null,
  "error": null
}
```

`kind`: `indexing` | `evaluation` | `model_download` | `auto_golden_set` | `batch_evaluation` | `dockerfile_export`.

### 13.2. `POST /tasks/{task_id}/cancel`

**응답 200**

```json
{ "cancelled": true, "task_id": "task_zzz000" }
```

설계서 §8.1에 따라 완료된 단계의 체크포인트는 보존되어, 재시작 시 이어서 진행 가능.

---

## 14. WebSocket 프로토콜

### 14.1. 연결 및 구독

```
WS /ws
```

연결 후 구독:

```json
{ "action": "subscribe", "topics": ["experiment:exp_42abcd", "chat:turn_aabbcc"] }
```

**응답**

```json
{ "type": "subscribed", "topics": ["experiment:exp_42abcd", "chat:turn_aabbcc"] }
```

구독 해제:

```json
{ "action": "unsubscribe", "topics": ["chat:turn_aabbcc"] }
```

### 14.2. 메시지 공통 형식

모든 서버 → 클라이언트 메시지는 `topic`, `type`을 포함:

```json
{ "topic": "experiment:exp_42abcd", "type": "progress", "...": "..." }
```

| `type` | 사용처 |
|---|---|
| `started` | 작업 시작 |
| `progress` | 진행률 (1초당 최대 1회로 throttle) |
| `completed` | 작업 정상 완료 |
| `cancelled` | 사용자 취소 |
| `failed` | 실패 |
| `token` | 채팅 토큰 (delta 포함) |
| `pair_completed` | 평가 단일 쌍 완료 |
| `document_skipped` | 인덱싱 캐시 히트 |
| `document_failed` | 인덱싱 부분 실패 |
| `model_download_progress` | 모델 다운로드 (P1) |

### 14.3. 토픽 명명 규칙

```
experiment:{experiment_id}     # 인덱싱·평가
chat:{turn_id}                  # 채팅 한 턴
model:{model_id}                # 모델 다운로드 (P1)
batch:{batch_id}                # 매트릭스 일괄 평가 (P1)
```

### 14.4. 재연결 정책

- 클라이언트는 끊어지면 지수 백오프로 재연결 (1s → 2s → 4s, 최대 30s).
- 재연결 후 `subscribe`를 다시 보낸다.
- 서버는 진행 중인 작업의 **현재 상태 스냅샷**을 즉시 한 번 푸시. 놓친 메시지가 있어도 최종 상태는 일치.

### 14.5. 백프레셔

- 채팅 토큰: 서버 큐 100 초과 시 가장 오래된 토큰부터 폐기. UI는 `completed`의 `full_answer`로 보정.
- 인덱싱·평가 진행률: 1초당 1회로 throttle.

---

## 15. P1 엔드포인트 (구체 명세)

### 15.0. 외부 LLM 제공자 키 관리

컨셉 §3.3.5와 설계서 §13-1에 따라 외부 LLM 사용 전 키 등록·확인 절차가 필수. 본 절은 그 인프라.

**지원 제공자 (4개)**: `openrouter`, `gemini`, `openai`, `anthropic`.

#### 15.0.1. `GET /system/external-providers`

각 제공자의 키 등록 여부와 상태를 조회. 키 자체는 절대 응답에 포함되지 않는다 (마지막 4자리만 표시).

**응답 200**

```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "key_registered": true,
      "key_suffix": "...sk-9aB2",
      "registered_at": "2026-04-26T18:00:00Z",
      "last_validated_at": "2026-04-26T18:00:00Z",
      "validation_status": "ok",
      "supported_models": ["gpt-4o", "gpt-4o-mini", "..."]
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "key_registered": false,
      "supported_models": ["claude-opus-4-7", "claude-sonnet-4-6", "..."]
    },
    {
      "id": "gemini",
      "name": "Google Gemini",
      "key_registered": false,
      "supported_models": ["gemini-2.5-pro", "gemini-2.5-flash", "..."]
    },
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "key_registered": false,
      "supported_models": ["...다양한 모델 라우팅..."]
    }
  ]
}
```

`validation_status`: `ok` | `invalid` | `network_error` | `rate_limited` | `not_validated`.

#### 15.0.2. `POST /system/external-providers/{provider_id}/key`

API 키 등록 또는 갱신.

**요청**

```json
{
  "key": "sk-...",
  "validate_now": true
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `key` | ✅ | 평문 API 키. HTTPS·로컬 통신 가정. |
| `validate_now` |  | 등록 직후 작은 ping 호출로 유효성 검증. 기본 `true`. |

**응답 200**

```json
{
  "provider_id": "openai",
  "key_registered": true,
  "key_suffix": "...sk-9aB2",
  "registered_at": "2026-04-27T10:00:00Z",
  "validation_status": "ok"
}
```

**응답 422**

```json
{
  "error": {
    "code": "EXTERNAL_API_KEY_INVALID",
    "message": "API 키 검증에 실패했습니다.",
    "recoverable": true,
    "details": { "provider_id": "openai", "validation_error": "401 Unauthorized" }
  }
}
```

#### 15.0.3. `DELETE /system/external-providers/{provider_id}/key`

키 제거. 해당 제공자를 사용 중인 워크스페이스가 있으면 `409`.

**응답 204**

**응답 409**

```json
{
  "error": {
    "code": "PROVIDER_IN_USE",
    "message": "이 제공자를 사용 중인 워크스페이스가 있습니다.",
    "recoverable": false,
    "details": { "workspace_ids": ["ws_a1b2c3"] }
  }
}
```

#### 15.0.4. `POST /system/external-providers/{provider_id}/validate`

이미 등록된 키를 다시 검증. 키 만료·요금제 변경 등을 감지.

**응답 200**

```json
{
  "provider_id": "openai",
  "validation_status": "ok",
  "validated_at": "2026-04-27T10:05:00Z"
}
```

#### 15.0.5. 외부 LLM 사용 흐름

채팅·평가에서 `llm_id: "external:openai:gpt-4o-mini"`를 사용할 때의 시퀀스.

```
1. 클라이언트가 채팅·평가 요청
2. 백엔드: keystore에서 openai 키 조회
3. 키 없음 → 422 EXTERNAL_API_KEY_NOT_REGISTERED
   → 프런트가 §15.0.2 등록 화면을 띄우고 사용자가 키 입력
   → 등록 성공 후 원래 요청 재시도
4. 키 있음 → 워크스페이스의 external 정책 검사
   → allow_llm_api: false → 422 EXTERNAL_API_NOT_ENABLED
   → allowed_providers에 없음 → 422 EXTERNAL_PROVIDER_NOT_ALLOWED
5. 모든 검증 통과 → 외부 호출 실행
   → infra/external/http_client가 WebSocket으로 external_call 이벤트 발행
   → 응답에 external_calls: ["openai:gpt-4o-mini"] 포함
```

키 등록 → 워크스페이스 옵트인 → 호출의 3단계가 명시적이다.

---

### 15.1. `GET /system/models`

다운로드 가능한 모델 카탈로그.

**쿼리**: `kind=embedder|llm|reranker`, `cursor`, `limit`.

**응답 200**

```json
{
  "items": [
    {
      "id": "model_bge_small",
      "kind": "embedder",
      "name": "BAAI/bge-small-en-v1.5",
      "size_mb": 130,
      "license": {
        "id": "MIT",
        "name": "MIT License",
        "acceptance_required": false,
        "commercial_use": "allowed",
        "url": "https://opensource.org/licenses/MIT"
      },
      "language": ["en"],
      "max_tokens": 512,
      "dim": 384,
      "downloaded": true,
      "recommended_min_vram_gb": null
    },
    {
      "id": "model_llama3_8b_q4",
      "kind": "llm",
      "name": "Llama-3 8B Instruct (Q4_K_M)",
      "size_mb": 4800,
      "license": {
        "id": "llama-3-community",
        "name": "Llama 3 Community License",
        "acceptance_required": true,
        "accepted_at": null,
        "commercial_use": "conditional",
        "url": "https://llama.meta.com/llama3/license/"
      },
      "language": ["en", "ko"],
      "max_context": 8192,
      "downloaded": false,
      "recommended_min_vram_gb": 6
    }
  ],
  "next_cursor": null
}
```

**라이선스 필드 설명** (컨셉 §9-4):
- `id`: 라이선스 식별자 (`MIT`, `Apache-2.0`, `llama-3-community` 등).
- `acceptance_required`: 다운로드 전 사용자의 명시적 동의가 필요한지.
- `accepted_at`: 사용자가 동의한 시각. `null`이면 미수락.
- `commercial_use`: `allowed` | `prohibited` | `conditional`. `conditional`이면 라이선스 본문에 조건 명시.
- `url`: 전문 링크.

UI는 `acceptance_required: true`인 모델 다운로드 시 라이선스 본문 모달을 띄우고 동의를 받아야 함. 동의 없이 다운로드 시도 시 `LICENSE_NOT_ACCEPTED` 에러.

### 15.2. `GET /system/models/{model_id}`

§15.1 단일 항목과 동일 구조 + 다운로드 URL 출처, 모델 카드 텍스트 등 추가.

### 15.3. `POST /system/models/{model_id}/download`

**요청**

```json
{
  "license_accepted": true
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `license_accepted` | 라이선스가 `acceptance_required: true`인 경우 ✅ | 사용자가 라이선스 본문을 읽고 동의했음을 명시. 미수락 모델 다운로드 시도 시 `422 LICENSE_NOT_ACCEPTED`. |

**응답 202**

```json
{
  "task_id": "task_dl_001",
  "websocket_topic": "model:model_bge_small",
  "estimated_size_mb": 130,
  "external_calls": ["huggingface.co"]
}
```

**응답 422 (라이선스 미수락)**

```json
{
  "error": {
    "code": "LICENSE_NOT_ACCEPTED",
    "message": "이 모델은 라이선스 동의가 필요합니다.",
    "recoverable": true,
    "details": {
      "model_id": "model_llama3_8b_q4",
      "license_id": "llama-3-community",
      "license_url": "https://llama.meta.com/llama3/license/"
    }
  }
}
```

**WebSocket**

```json
{ "topic": "model:model_bge_small", "type": "model_download_progress",
  "downloaded_mb": 65, "total_mb": 130, "speed_mbps": 12.5 }

{ "topic": "model:model_bge_small", "type": "completed",
  "model_id": "model_bge_small", "duration_seconds": 11 }
```

### 15.4. `DELETE /system/models/{model_id}`

로컬 캐시에서 모델 파일 제거.

**응답 204**
**응답 409**: 워크스페이스 중 하나가 이 모델을 사용 중.

```json
{
  "error": {
    "code": "MODEL_IN_USE",
    "message": "이 모델을 사용 중인 워크스페이스가 있습니다.",
    "recoverable": false,
    "details": { "workspace_ids": ["ws_a1b2c3"] }
  }
}
```

### 15.5. `POST /workspaces/{id}/golden-sets/{gs_id}/auto-generate`

LLM 기반 자동 골든 셋 생성.

**요청**

```json
{
  "target_count": 30,
  "judge_llm_id": "local:llama-3-8b-q4",
  "source_document_ids": null,
  "diversity_strategy": "balanced"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `target_count` | ✅ | 1~200. |
| `judge_llm_id` |  | 기본은 워크스페이스 LLM. |
| `source_document_ids` |  | `null`이면 전체. |
| `diversity_strategy` |  | `balanced`(여러 문서 골고루) \| `random`. |

**응답 202**

```json
{
  "task_id": "task_autogen_001",
  "websocket_topic": "auto_golden_set:gs_fedcba",
  "estimated_duration_seconds": 360,
  "external_calls": []
}
```

생성된 쌍은 `status: pending_review`로 마크되어 사용자 검수가 필요. 검수 후 `PATCH .../pairs/{pair_id}`로 `status: approved` 전환 (해당 PATCH 엔드포인트는 P1 후반부에 추가).

### 15.6. `POST /workspaces/{id}/experiments/batch`

후보 매트릭스 일괄 평가. 엔지니어 페르소나의 핵심 기능.

**요청**

```json
{
  "matrix": {
    "embedder_ids": ["BAAI/bge-small-en-v1.5", "BAAI/bge-large-en-v1.5"],
    "chunking_configs": [
      { "strategy": "recursive", "chunk_size": 256, "chunk_overlap": 32 },
      { "strategy": "recursive", "chunk_size": 512, "chunk_overlap": 64 }
    ],
    "retrieval_strategies": ["dense", "hybrid"],
    "top_ks": [5]
  },
  "golden_set_id": "gs_fedcba",
  "judge_llm_id": "local:llama-3-8b-q4",
  "max_parallel": 1
}
```

조합 수 = 임베더 × 청킹 × 검색 × top_k. 위 예시는 2×2×2×1 = 8개 조합.

**응답 202**

```json
{
  "batch_id": "batch_001",
  "task_id": "task_batch_001",
  "websocket_topic": "batch:batch_001",
  "experiment_ids": ["exp_001", "exp_002", "exp_003", "exp_004", "exp_005", "exp_006", "exp_007", "exp_008"],
  "estimated_duration_seconds": 1920,
  "external_calls": []
}
```

**응답 422**: 매트릭스가 너무 크면 (> 50조합) 거부.

```json
{
  "error": {
    "code": "MATRIX_TOO_LARGE",
    "message": "매트릭스 조합 수(72)가 한도(50)를 초과합니다.",
    "recoverable": false,
    "details": { "combination_count": 72, "limit": 50 }
  }
}
```

**WebSocket**

```json
{ "topic": "batch:batch_001", "type": "experiment_started",
  "experiment_id": "exp_001", "index": 1, "total": 8 }

{ "topic": "batch:batch_001", "type": "experiment_completed",
  "experiment_id": "exp_001", "scores": { "...": "..." } }

{ "topic": "batch:batch_001", "type": "completed",
  "batch_id": "batch_001",
  "best_experiment_id": "exp_005",
  "ranking": [
    { "experiment_id": "exp_005", "composite_score": 0.87 },
    { "experiment_id": "exp_002", "composite_score": 0.84 }
  ] }
```

### 15.7. `POST /workspaces/{id}/serve`

선택한 실험 설정으로 RAG API를 별도 포트에 띄운다.

**요청**

```json
{
  "experiment_id": "exp_42abcd",
  "port": 9001,
  "compatibility": "openrag",
  "cors_origins": ["http://localhost:3000"]
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `experiment_id` | ✅ |  |
| `port` |  | 미지정 시 자동 할당 (9001부터). |
| `compatibility` |  | `openrag`(자체) \| `openai`(OpenAI 호환). |
| `cors_origins` |  | CORS 허용 출처. |

**응답 200**

```json
{
  "served_at": "http://127.0.0.1:9001",
  "openapi_url": "http://127.0.0.1:9001/openapi.json",
  "experiment_id": "exp_42abcd",
  "status": "running",
  "started_at": "..."
}
```

서빙된 RAG API의 엔드포인트 (자체 포맷):
- `GET /v1/health`
- `POST /v1/query` — `{ "question": "...", "top_k": 5 }` → `{ "answer": "...", "citations": [...] }`

OpenAI 호환 모드:
- `POST /v1/chat/completions` (RAG 컨텍스트가 자동으로 system 메시지에 주입됨)

### 15.8. `GET /workspaces/{id}/serve`

현재 서빙 상태 조회. §15.7 응답과 동일 구조 + `not_running`인 경우 `status: "stopped"`.

### 15.9. `DELETE /workspaces/{id}/serve`

서버 중지.

**응답 204**

### 15.10. `GET /workspaces/{id}/serve/openapi.json`

현재 서빙 중인 RAG API의 OpenAPI 스펙. 외부 시스템 통합 시 사용.

---

## 16. P2 엔드포인트 (구체 명세)

### 16.1. `POST /workspaces/{id}/export/dockerfile`

선택한 실험 설정 그대로 컨테이너화할 Dockerfile 생성.

**요청**

```json
{
  "experiment_id": "exp_42abcd",
  "include_models": false,
  "base_image": "python:3.11-slim",
  "expose_port": 9001
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `experiment_id` | ✅ |  |
| `include_models` |  | `true`면 이미지에 모델 가중치 포함 (이미지 크기 큼). |
| `base_image` |  | 기본은 GPU 환경에 맞춰 자동 선택. |
| `expose_port` |  | RAG API 포트. |

**응답 202**

```json
{
  "task_id": "task_docker_001",
  "websocket_topic": "experiment:exp_42abcd"
}
```

**WebSocket completed 시 result_ref**

```json
{ "topic": "experiment:exp_42abcd", "type": "completed",
  "result_ref": {
    "dockerfile_path": "/workspaces/ws_.../exports/dockerfile-fp_a1b2c3.tar.gz",
    "build_command": "docker build -t openrag-lab:exp_42abcd .",
    "size_estimate_mb": 5200
  } }
```

별도 다운로드 엔드포인트로 사용자가 파일을 받을 수 있게 한다 (`GET /workspaces/{id}/exports/{export_id}` — P2 후반부).

### 16.2. `POST /workspaces/{id}/share/export`

워크스페이스 전체를 공유 가능한 패키지(`tar.gz`)로 만든다.

**요청**

```json
{
  "include_documents": true,
  "include_vectors": true,
  "include_experiments": true,
  "include_golden_sets": true,
  "redact_paths": true
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `redact_paths` |  | `true`면 원본 파일 경로를 익명화. 다른 사용자에게 보낼 때 권장. |
| `include_vectors` |  | `false`면 받는 쪽에서 재인덱싱 필요하지만 패키지 크기 감소. |

**응답 202**

```json
{
  "task_id": "task_share_001",
  "estimated_size_mb": 240
}
```

**완료 후**

```json
{
  "type": "completed",
  "result_ref": {
    "package_path": "/exports/ws_a1b2c3.openrag.tar.gz",
    "size_mb": 238,
    "manifest": {
      "documents": 12,
      "experiments": 3,
      "golden_sets": 1,
      "openrag_version": "1.0.0"
    }
  }
}
```

### 16.3. `POST /workspaces/import`

공유 패키지를 새 워크스페이스로 복원.

**요청** (`multipart/form-data`)

```
package: ws_a1b2c3.openrag.tar.gz
new_name: "받은 자료실"
```

**응답 201**

```json
{
  "id": "ws_new001",
  "name": "받은 자료실",
  "manifest": { "...": "..." },
  "warnings": ["VECTORS_NOT_INCLUDED"],
  "next_action_required": "reindex"
}
```

`warnings` 종류:
- `VECTORS_NOT_INCLUDED`: 받은 쪽에서 인덱싱 필요.
- `MODEL_NOT_AVAILABLE_LOCALLY`: 사용된 모델이 로컬에 없음. 자동 다운로드 또는 다른 모델 선택 필요.
- `OPENRAG_VERSION_MISMATCH`: 패키지의 OpenRAG 버전이 다름.

---

## 17. 결정 사항 (Decisions)

설계서 §13의 결정사항이 API에 미치는 영향. v4에서 모든 핵심 결정이 확정되었다.

> **OS 관련 결정 (v3)**: macOS · Windows · Linux 동등 지원. §4.1 `/system/profile`이 모든 정보 노출. 상세는 `PLATFORM.md`.
> **외부 LLM 결정 (v4)**: §17.1 참조.
> **검색 전용 모드 결정 (v4)**: §9.1.1 참조.
> **임베더 차원 변경 결정 (v4)**: §12.2 참조.

### 17.1. 외부 LLM API (해결됨, v4)

**결정**: 4개 제공자 (OpenRouter, Gemini, OpenAI, Anthropic) 어댑터 P1 추가. 키 등록·검증 절차 필수.

**API 명세**:
- `llm_id`·`judge_llm_id` 명명: `local:<key>` 또는 `external:<provider>:<model>`.
- `<provider>`: `openrouter` | `gemini` | `openai` | `anthropic`.
- 외부 호출 시 응답에 `external_calls: ["openai:gpt-4o-mini"]` 형식 포함.
- 키 미등록 시 자동 호출 금지 → §15.0 흐름 따름 (422 에러로 등록 화면 안내).
- 워크스페이스의 `external.allow_llm_api` (CONFIG_SCHEMA §4.5)와 `allowed_providers`로 사용 범위 제어.

### 17.2. 비로컬 바인딩 시 인증

**영향**: `--bind 0.0.0.0` 사용 시 토큰 기반 인증.

**기본 제안 (P1)**:

```
POST /auth/token
{ "passphrase": "..." }     # 서버 시작 시 콘솔에 출력된 패스프레이즈

→ { "token": "...", "expires_at": "..." }
```

이후 모든 요청에 `Authorization: Bearer <token>` 헤더 필수.

### 17.3. 다중 동시 채팅

**영향**: 같은 LLM에 대한 동시 호출 큐잉.

**기본 제안**: 채팅은 동시 다수 허용 (읽기 전용). 단, 같은 LLM 인스턴스에 대해서는 백엔드 큐가 순차 처리. 큐 길이 초과 시 `429 Too Many Requests` (구체 한도는 추후 결정).

### 17.4. Citation 정밀도 (`spans_in_answer`)

**영향**: 채팅 응답의 인용 표시 깊이.

**기본 제안**: MVP는 청크 인용 목록만 (chunk_id 기준). P1에서 `spans_in_answer` (답변의 어느 글자 범위가 어느 청크에 근거하는지) 추가.

### 17.5. 매트릭스 평가 한도

**영향**: §15.6의 `MATRIX_TOO_LARGE` 임계값.

**기본 제안**: 50조합. 그 이상은 사용자가 의도치 않게 며칠 걸리는 작업을 시작할 위험. 사용자 설정으로 상향 가능.

### 17.6. Bundle 모드 베이스 경로

**영향**: 정적 프런트와 API의 경로 충돌 회피.

**기본 제안**: `/api` 접두로 통일. 프런트는 루트에서 서빙.

---

## 18. 변경 관리

- 본 명세는 설계서(SDD)와 짝을 이룬다. SDD §3 Application Layer가 변경되면 본 명세도 함께 갱신.
- breaking change 시 베이스 URL 버전을 올린다 (`/api/v1` → `/api/v2`). MVP는 무버전 또는 `/api/v1`로 통일.
- 새 엔드포인트 추가 시 §3 인덱스를 함께 업데이트.
- `error_code` 추가 시 별도 ERROR_CODES.md에 기록 (장기적으로).
