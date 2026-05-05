# OpenRAG-Lab 에러 코드 카탈로그 (ERROR_CODES.md v2)

> **이 문서의 위치**: 5개 문서(컨셉, 설계서, API 명세서, PLATFORM, CONFIG_SCHEMA)에 흩어진 모든 `error_code`의 단일 출처.
> **독자**:
> - 백엔드 개발자(Claude Code) — 어떤 코드를 언제 던질지 결정.
> - 프런트엔드 개발자 — 코드별 UI 처리 분기.
> - QA — 시나리오별 기대 코드 검증.
> **포함되는 것**: 사용자에게 노출되는 `error.code` 값. 내부 도메인 예외 클래스 매핑 포함.
> **포함되지 않는 것**: 로그 전용 식별자, 외부 라이브러리의 native 예외.
> **변경 이력**:
> - v1→v2: 외부 LLM 키 등록 관련 코드 4개 추가 / `LICENSE_NOT_ACCEPTED` 정식 등록 / `RETRIEVAL_ONLY_MODE` 정보 코드 추가.
> - v2→v3: 프록시·TLS 관련 코드 2개 추가 (`PROXY_AUTH_REQUIRED`, `PROXY_TLS_VERIFICATION_FAILED`).

---

## 1. 사용 원칙

### 1.1. 코드 명명 규칙

- **모두 대문자 + 언더스코어**. (예: `PARSE_ENCRYPTED_PDF`)
- **명사형 또는 상황 서술형**. 동작이 아닌 상황을 표현.
- **prefix로 도메인 표시**: `PARSE_*`, `INDEX_*`, `MODEL_*`, `CONFIG_*`, `EXTERNAL_*` 등.
- **40자 이하**. 너무 길면 분할.
- **ASCII만**.

### 1.2. 응답 형식 (재확인)

API 명세서 §2.3에서 정의한 것을 따른다.

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

| 필드 | 의미 |
|---|---|
| `code` | 본 카탈로그의 식별자. 기계가 분기에 사용. |
| `message` | 사용자 표시용. 한국어. 향후 i18n 가능하게 코드와 분리. |
| `recoverable` | 재시도하면 다른 결과를 기대할 수 있는가. |
| `details` | 코드별로 정해진 추가 컨텍스트. 본 카탈로그가 정의. |

### 1.3. 신규 코드 추가 절차

1. 본 문서에 코드 항목 추가 (§3 이하 분류 중 적절한 곳).
2. 트리거 조건, `recoverable`, `details` 스키마, 권장 UI 처리, HTTP 상태를 모두 작성.
3. 발생 위치(어떤 어댑터/서비스/API 엔드포인트)를 함께 표기.
4. 관련 문서(API 명세서, 설계서)에서 인용 시 링크.

### 1.4. Deprecation 정책

- 코드 의미 변경은 금지. 변경이 필요하면 새 코드를 추가하고 기존 코드는 deprecated 표시.
- Deprecated 코드는 §11에 모아둔다 (현재 비어 있음).

---

## 2. 분류 인덱스

| 카테고리 | 범위 | 섹션 |
|---|---|---|
| 입력 검증 | 사용자 입력 형식·범위 오류 | §3 |
| 파싱 | 문서 파싱 실패 | §4 |
| 청킹·임베딩·검색 | 파이프라인 단계별 | §5 |
| 인덱싱 작업 | 비동기 작업·동시성 | §6 |
| 모델 관리 | 다운로드·캐시·호환성 | §7 |
| 외부 호출 | LLM API·HuggingFace | §8 |
| 설정 (YAML) | config 임포트·검증 | §9 |
| 시스템·플랫폼 | OS·하드웨어·경로 | §10 |
| Deprecated | 사용 금지 | §11 |

---

## 3. 입력 검증 에러

### `BAD_REQUEST_FIELD`
**HTTP**: 400 / **Recoverable**: ✅ / **발생**: API 입력 일반.

JSON 본문이 스키마와 맞지 않을 때의 일반 코드. 더 구체적인 코드가 있으면 그쪽 우선.

```json
{ "code": "BAD_REQUEST_FIELD",
  "message": "필드 'top_k'는 정수여야 합니다.",
  "recoverable": true,
  "details": { "field": "top_k", "received_type": "string", "expected_type": "integer" } }
```

**UI 처리**: 해당 필드에 인라인 에러 표시.

---

### `WORKSPACE_NOT_FOUND`
**HTTP**: 404 / **Recoverable**: ❌ / **발생**: `/workspaces/{id}/*` 모든 엔드포인트.

```json
{ "code": "WORKSPACE_NOT_FOUND",
  "message": "워크스페이스를 찾을 수 없습니다.",
  "recoverable": false,
  "details": { "workspace_id": "ws_xxx" } }
```

**UI 처리**: 워크스페이스 목록으로 리다이렉트.

---

### `DOCUMENT_NOT_FOUND`
**HTTP**: 404 / **Recoverable**: ❌

```json
{ "details": { "document_id": "doc_xxx" } }
```

---

### `EXPERIMENT_NOT_FOUND`
**HTTP**: 404 / **Recoverable**: ❌

```json
{ "details": { "experiment_id": "exp_xxx" } }
```

---

### `GOLDEN_SET_NOT_FOUND`
**HTTP**: 404 / **Recoverable**: ❌

```json
{ "details": { "golden_set_id": "gs_xxx" } }
```

---

## 4. 파싱 에러

### `PARSE_ENCRYPTED_PDF`
**HTTP**: 422 (업로드 시) / **Recoverable**: ❌
**발생**: `adapters/parsers/pdf_pymupdf.py`의 `parse()`.

암호화된 PDF는 처리하지 않음. 사용자가 직접 잠금 해제 후 재업로드 필요.

```json
{ "code": "PARSE_ENCRYPTED_PDF",
  "message": "암호화된 PDF는 처리할 수 없습니다. 잠금을 해제한 후 다시 업로드하세요.",
  "recoverable": false,
  "details": { "filename": "secret.pdf" } }
```

**UI 처리**: 업로드 결과의 `failed` 배열에 표시. 다른 문서는 정상 처리.

---

### `PARSE_CORRUPTED_FILE`
**HTTP**: 422 / **Recoverable**: ❌

파일이 손상되어 파서가 읽기 실패. PDF·DOCX·기타 모든 포맷 공통.

```json
{ "code": "PARSE_CORRUPTED_FILE",
  "message": "파일이 손상되어 읽을 수 없습니다.",
  "recoverable": false,
  "details": { "filename": "broken.pdf", "format": "pdf", "underlying_error": "..." } }
```

---

### `PARSE_UNSUPPORTED_FORMAT`
**HTTP**: 422 / **Recoverable**: ❌

지원하지 않는 포맷. (MVP는 PDF/TXT/MD만, P1에서 DOCX/HTML/JSON/EPUB 추가)

```json
{ "code": "PARSE_UNSUPPORTED_FORMAT",
  "message": "지원하지 않는 파일 형식입니다: .xlsx",
  "recoverable": false,
  "details": { "filename": "report.xlsx", "extension": "xlsx" } }
```

---

### `PARSE_EMPTY_DOCUMENT`
**HTTP**: 422 / **Recoverable**: ❌

파싱은 성공했지만 추출된 텍스트가 비어 있음. 스캔 PDF가 OCR 없이 들어왔을 때 흔함.

```json
{ "code": "PARSE_EMPTY_DOCUMENT",
  "message": "문서에서 텍스트를 추출할 수 없습니다. 스캔 이미지일 수 있습니다.",
  "recoverable": false,
  "details": { "filename": "scan.pdf", "extracted_chars": 0 } }
```

**UI 처리**: 사용자에게 "OCR이 필요할 수 있다"는 안내.

---

### `FILE_LOCKED`
**HTTP**: 503 / **Recoverable**: ✅
**발생**: Windows에서 다른 프로세스가 파일을 열고 있을 때 (PLATFORM.md §4.1).

```json
{ "code": "FILE_LOCKED",
  "message": "파일이 다른 프로세스에서 사용 중입니다. 닫은 후 다시 시도하세요.",
  "recoverable": true,
  "details": { "filename": "report.pdf", "platform": "windows" } }
```

**UI 처리**: 재시도 버튼 표시.

---

## 5. 청킹·임베딩·검색 에러

### `CHUNK_SIZE_EXCEEDS_EMBEDDER_LIMIT`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: `/index` 호출 시, `EmbeddingService.validate()`.

청크 크기가 임베더의 최대 토큰을 초과. 사용자가 청크 크기를 줄이거나 임베더를 변경해야 함.

```json
{ "code": "CHUNK_SIZE_EXCEEDS_EMBEDDER_LIMIT",
  "message": "청크 크기(2048)가 임베더 'all-MiniLM-L6-v2'의 최대 토큰(512)을 초과합니다.",
  "recoverable": true,
  "details": { "chunk_size": 2048, "embedder_max_tokens": 512, "embedder_id": "all-MiniLM-L6-v2" } }
```

**UI 처리**: 청킹 슬라이더의 최댓값을 임베더 한도로 제한하여 사전에 방지.

---

### `EMBEDDER_DIM_MISMATCH`
**HTTP**: 422 / **Recoverable**: ❌
**발생**: 새 임베더로 검색을 수행하려는데 기존 인덱스의 차원이 다름.

```json
{ "code": "EMBEDDER_DIM_MISMATCH",
  "message": "임베더 차원이 기존 인덱스(384)와 다릅니다(1024). 재인덱싱이 필요합니다.",
  "recoverable": false,
  "details": { "expected_dim": 384, "actual_dim": 1024 } }
```

**UI 처리**: 재인덱싱 안내 모달 표시.

---

### `RETRIEVAL_NO_INDEX`
**HTTP**: 422 / **Recoverable**: ✅

검색을 시도했으나 해당 워크스페이스에 인덱스가 없음.

```json
{ "code": "RETRIEVAL_NO_INDEX",
  "message": "이 워크스페이스에 인덱스가 없습니다. 먼저 문서를 인덱싱해 주세요.",
  "recoverable": true,
  "details": { "workspace_id": "ws_xxx" } }
```

**UI 처리**: 인덱싱 화면으로 안내 버튼.

---

## 6. 인덱싱 작업 에러

### `INDEXING_IN_PROGRESS`
**HTTP**: 409 / **Recoverable**: ✅
**발생**: `/index` 호출 시 같은 워크스페이스에 이미 작업 진행 중.

설계서 §8.1: 인덱싱은 동시 1개 정책.

```json
{ "code": "INDEXING_IN_PROGRESS",
  "message": "이미 인덱싱이 진행 중입니다.",
  "recoverable": true,
  "details": { "running_task_id": "task_yyy999" } }
```

**UI 처리**: 진행 중 태스크의 진행률 화면으로 안내.

---

### `WORKSPACE_BUSY`
**HTTP**: 409 / **Recoverable**: ✅
**발생**: 진행 중 작업이 있어 워크스페이스 삭제 등이 불가.

```json
{ "code": "WORKSPACE_BUSY",
  "message": "진행 중인 작업이 있어 삭제할 수 없습니다.",
  "recoverable": true,
  "details": { "running_task_id": "task_yyy999" } }
```

---

### `TASK_NOT_FOUND`
**HTTP**: 404 / **Recoverable**: ❌

```json
{ "details": { "task_id": "task_xxx" } }
```

---

### `TASK_ALREADY_COMPLETED`
**HTTP**: 409 / **Recoverable**: ❌

이미 완료·실패·취소된 작업에 대해 cancel 등을 호출할 때.

```json
{ "code": "TASK_ALREADY_COMPLETED",
  "message": "이미 완료된 작업입니다.",
  "recoverable": false,
  "details": { "task_id": "task_xxx", "status": "completed" } }
```

---

### `MATRIX_TOO_LARGE`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: `/experiments/batch` (P1) 호출 시 조합 수가 한도 초과.

```json
{ "code": "MATRIX_TOO_LARGE",
  "message": "매트릭스 조합 수(72)가 한도(50)를 초과합니다.",
  "recoverable": true,
  "details": { "combination_count": 72, "limit": 50 } }
```

**UI 처리**: 사용자가 매트릭스 차원을 줄이거나 한도 상향 옵션 안내.

---

## 7. 모델 관리 에러

### `MODEL_NOT_FOUND`
**HTTP**: 404 / **Recoverable**: ❌

카탈로그에 없는 모델 ID.

```json
{ "details": { "model_id": "...", "available_models": ["..."] } }
```

---

### `MODEL_NOT_AVAILABLE_LOCALLY`
**HTTP**: 503 / **Recoverable**: ✅
**발생**: 사용하려는 모델이 로컬에 없을 때 (다운로드 필요).

```json
{ "code": "MODEL_NOT_AVAILABLE_LOCALLY",
  "message": "모델 'BAAI/bge-large-en-v1.5'이 로컬에 없습니다. 다운로드가 필요합니다.",
  "recoverable": true,
  "details": { "model_id": "BAAI/bge-large-en-v1.5", "size_mb": 1340 } }
```

**UI 처리**: "지금 다운로드" 버튼 표시.

---

### `MODEL_NOT_LOADED`
**HTTP**: 500 / **Recoverable**: ✅
**발생**: 도메인 예외 `ModelNotLoadedError`가 어댑터에서 변환됨.

모델 파일은 있지만 메모리에 로드 실패. 원인은 OOM 또는 파일 손상.

```json
{ "code": "MODEL_NOT_LOADED",
  "message": "모델을 로드할 수 없습니다.",
  "recoverable": true,
  "details": { "model_id": "...", "underlying": "..." } }
```

---

### `MODEL_IN_USE`
**HTTP**: 409 / **Recoverable**: ❌
**발생**: 다른 워크스페이스가 사용 중인 모델을 삭제하려 할 때.

```json
{ "code": "MODEL_IN_USE",
  "message": "이 모델을 사용 중인 워크스페이스가 있습니다.",
  "recoverable": false,
  "details": { "workspace_ids": ["ws_a1b2c3"] } }
```

---

### `MODEL_DOWNLOAD_FAILED`
**HTTP**: 503 / **Recoverable**: ✅

```json
{ "code": "MODEL_DOWNLOAD_FAILED",
  "message": "모델 다운로드에 실패했습니다.",
  "recoverable": true,
  "details": { "model_id": "...", "attempt": 3, "underlying": "ConnectionError" } }
```

---

### `OUT_OF_MEMORY`
**HTTP**: 507 / **Recoverable**: ✅
**발생**: 도메인 예외 `OutOfMemoryError`가 어댑터에서 변환됨.

```json
{ "code": "OUT_OF_MEMORY",
  "message": "메모리가 부족합니다. 더 작은 모델을 사용하거나 다른 작업을 종료한 후 다시 시도하세요.",
  "recoverable": true,
  "details": { "stage": "embedding", "required_mb": 4096, "available_mb": 1800 } }
```

**UI 처리**: 더 가벼운 프리셋 추천.

---

### `BACKEND_UNAVAILABLE`
**HTTP**: 503 / **Recoverable**: ✅
**발생**: 가속 백엔드 초기화 실패 (PLATFORM.md §3.5).

```json
{ "code": "BACKEND_UNAVAILABLE",
  "message": "GPU 가속을 사용할 수 없습니다. CPU로 진행합니다.",
  "recoverable": true,
  "details": { "requested": "cuda", "fallback": "cpu", "reason": "..." } }
```

`fallback_to_cpu: true`이면 자동 진행 후 warning만, `false`이면 실제로 작업 실패.

---

### `BACKEND_NOT_AVAILABLE`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: YAML 임포트 시 사용자가 명시한 백엔드가 현재 OS에서 불가능.

`BACKEND_UNAVAILABLE`(런타임 실패)와 구분: 이쪽은 설정 검증 시점의 거부.

```json
{ "code": "BACKEND_NOT_AVAILABLE",
  "message": "'metal' 백엔드는 현재 OS(windows)에서 사용 불가능합니다.",
  "recoverable": true,
  "details": { "preferred": "metal", "current_os": "windows", "available": ["cuda", "cpu"] } }
```

---

### `LICENSE_NOT_ACCEPTED`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: 라이선스 수락이 필요한 모델 다운로드 시 (Llama 등) `license_accepted: true` 없이 호출됨.
컨셉 §9-4, API §15.3.

```json
{ "code": "LICENSE_NOT_ACCEPTED",
  "message": "이 모델은 라이선스 동의가 필요합니다.",
  "recoverable": true,
  "details": {
    "model_id": "model_llama3_8b_q4",
    "license_id": "llama-3-community",
    "license_url": "https://llama.meta.com/llama3/license/"
  } }
```

**UI 처리**: 라이선스 본문 모달 표시 → "동의" 클릭 → 동의 이력 로컬 기록 후 `license_accepted: true`로 다운로드 재시도.

---

### `RETRIEVAL_ONLY_MODE` (정보)
**HTTP**: 200 / **Recoverable**: n/a (정상 동작 알림)
**발생**: 응답 본문에 직접 포함되지는 않지만, 다음 응답에서 모드 표시용.

채팅 응답의 `mode: "retrieval_only"` 필드 (API §9.1.1)와 평가 결과의 LLM 의존 지표 `null` 처리(`{ "faithfulness": null, ... }`)는 정상 동작이며 에러가 아니다. 본 항목은 카탈로그상 "코드처럼 보이지만 에러가 아닌" 표시를 명시하기 위해 둔다.

**UI 처리**: 채팅 화면·실험 결과에 "검색 전용 모드" 배지 표시. 비활성 지표는 회색으로 처리하고 "LLM 미사용" 툴팁.

---

## 8. 외부 호출 에러

### `EXTERNAL_PROVIDER_NOT_ALLOWED`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: `external:openai:*` 사용 시도했으나 `external.allowed_providers`에 없음.

```json
{ "code": "EXTERNAL_PROVIDER_NOT_ALLOWED",
  "message": "외부 제공자 'openai'가 허용 목록에 없습니다.",
  "recoverable": true,
  "details": { "provider": "openai", "allowed": [] } }
```

**UI 처리**: 설정 화면으로 안내해 허용 추가.

---

### `EXTERNAL_API_KEY_MISSING`
**HTTP**: 422 / **Recoverable**: ✅

API 키가 settings.yaml에 없음.

```json
{ "details": { "provider": "openai" } }
```

---

### `EXTERNAL_API_FAILED`
**HTTP**: 503 / **Recoverable**: ✅
**발생**: 도메인 예외 `ExternalApiError`.

```json
{ "code": "EXTERNAL_API_FAILED",
  "message": "외부 API 호출에 실패했습니다.",
  "recoverable": true,
  "details": { "provider": "openai", "status_code": 429, "retry_after_seconds": 30 } }
```

---

### `EXTERNAL_API_NOT_ENABLED`
**HTTP**: 422 / **Recoverable**: ✅

`external.allow_llm_api: false`인 워크스페이스에서 외부 LLM 사용 시도.

```json
{ "details": { "workspace_id": "ws_xxx", "attempted_llm_id": "external:openai:gpt-4o-mini" } }
```

---

### `EXTERNAL_API_KEY_NOT_REGISTERED`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: 외부 LLM 호출 시도 시 keystore에 해당 provider의 키가 없음.

컨셉 §3.3.5와 API §15.0.5 흐름의 핵심: 키 등록 없이 자동으로 호출하지 않고 사용자에게 등록 화면을 띄우게 한다.

```json
{ "code": "EXTERNAL_API_KEY_NOT_REGISTERED",
  "message": "openai 제공자의 API 키가 등록되어 있지 않습니다.",
  "recoverable": true,
  "details": {
    "provider_id": "openai",
    "registration_endpoint": "/system/external-providers/openai/key"
  } }
```

**UI 처리**: §15.0.2 키 등록 모달을 즉시 표시. 등록 성공 후 원래 요청 자동 재시도.

---

### `EXTERNAL_API_KEY_INVALID`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: 키 등록 시도 시 검증 호출이 실패하거나, 이미 등록된 키가 만료·무효화됨.

```json
{ "code": "EXTERNAL_API_KEY_INVALID",
  "message": "API 키 검증에 실패했습니다.",
  "recoverable": true,
  "details": {
    "provider_id": "openai",
    "validation_error": "401 Unauthorized",
    "validated_at": "2026-04-27T10:00:00Z"
  } }
```

**UI 처리**: 키 재입력 화면. "키가 유효하지 않거나 만료되었습니다" 메시지.

---

### `EXTERNAL_PROVIDER_UNKNOWN`
**HTTP**: 422 / **Recoverable**: ❌
**발생**: 4개 지원 provider(`openrouter` / `gemini` / `openai` / `anthropic`) 외의 이름이 사용됨.

```json
{ "code": "EXTERNAL_PROVIDER_UNKNOWN",
  "message": "지원하지 않는 외부 제공자입니다: 'mistral'.",
  "recoverable": false,
  "details": {
    "provider_id": "mistral",
    "supported_providers": ["openrouter", "gemini", "openai", "anthropic"]
  } }
```

**UI 처리**: YAML 편집 시 자동완성·linter로 사전 방지. 발생 시 인라인 에러.

---

### `PROVIDER_IN_USE`
**HTTP**: 409 / **Recoverable**: ❌
**발생**: 사용 중인 provider의 키를 삭제 시도 (API §15.0.3).

```json
{ "code": "PROVIDER_IN_USE",
  "message": "이 제공자를 사용 중인 워크스페이스가 있습니다.",
  "recoverable": false,
  "details": {
    "provider_id": "openai",
    "workspace_ids": ["ws_a1b2c3", "ws_d4e5f6"]
  } }
```

**UI 처리**: 영향 받는 워크스페이스 목록을 보여주고 사용자가 먼저 그쪽 설정을 변경하도록 안내.

---

### `PROXY_AUTH_REQUIRED`
**HTTP**: 502 / **Recoverable**: ✅
**발생**: 외부 호출 시 프록시 서버가 407 Proxy Authentication Required 응답. 또는 settings.yaml의 `network.proxy.auth.password_env`로 지정한 환경변수가 비어 있음 (PLATFORM.md §11.3).

```json
{ "code": "PROXY_AUTH_REQUIRED",
  "message": "프록시 인증에 실패했습니다. 자격 증명을 확인하세요.",
  "recoverable": true,
  "details": {
    "proxy_host": "proxy.corp.example.com:8080",
    "auth_source": "settings.yaml",
    "missing_env_var": "PROXY_PASSWORD"
  } }
```

비밀번호 자체나 `username` 외 PII는 응답에 포함하지 않는다. `proxy_host`는 호스트:포트만 (스킴·credentials 미포함).

**UI 처리**: 글로벌 설정 → 네트워크 화면으로 안내. 환경변수 설정 가이드 링크.

---

### `PROXY_TLS_VERIFICATION_FAILED`
**HTTP**: 502 / **Recoverable**: ✅
**발생**: 외부 호출의 TLS 핸드셰이크 검증 실패. 사내망 TLS 인터셉트 환경에서 사내 CA가 신뢰 저장소에 없을 때 흔함 (PLATFORM.md §11.4).

```json
{ "code": "PROXY_TLS_VERIFICATION_FAILED",
  "message": "TLS 인증서 검증에 실패했습니다. 사내 CA 인증서 등록이 필요할 수 있습니다.",
  "recoverable": true,
  "details": {
    "host": "huggingface.co",
    "ca_source": "truststore",
    "underlying": "self signed certificate in certificate chain",
    "remedy": "settings.yaml의 network.tls.ca_bundle_path에 사내 CA(PEM) 경로를 지정하세요."
  } }
```

**UI 처리**: 사내 CA 등록 가이드 모달 (PLATFORM.md §11.4 링크). `network.tls.verify: false`는 디버그용으로만 안내하고 권장하지 않음.

---

## 9. 설정 (YAML) 에러

### `CONFIG_VALIDATION_FAILED`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: `/config/import` (CONFIG_SCHEMA.md §7).

복합 검증 실패. `details.errors`에 모든 위반을 모아 반환.

```json
{ "code": "CONFIG_VALIDATION_FAILED",
  "message": "설정 검증 실패",
  "recoverable": true,
  "details": {
    "errors": [
      { "path": "config.chunking.chunk_size", "code": "VALUE_OUT_OF_RANGE", "message": "..." },
      { "path": "config.embedder_id", "code": "UNKNOWN_FIELD", "message": "..." }
    ]
  } }
```

`details.errors[].code`에는 다음 하위 코드들이 들어간다.

#### 하위 코드: `UNKNOWN_FIELD`
- 알 수 없는 필드 (오타 의심).

#### 하위 코드: `MISSING_REQUIRED_FIELD`
- 필수 필드 누락.

#### 하위 코드: `WRONG_TYPE`
- 타입 불일치.

#### 하위 코드: `VALUE_OUT_OF_RANGE`
- 정수 범위 초과 등.

#### 하위 코드: `INVALID_ENUM_VALUE`
- enum 값 미허용.

#### 하위 코드: `INVALID_REFERENCE`
- 참조 ID(임베더, LLM 등)가 카탈로그에 없음.

---

### `CONFIG_VERSION_TOO_NEW`
**HTTP**: 422 / **Recoverable**: ❌

YAML의 `version`이 현재 OpenRAG-Lab보다 신버전 (구버전 앱으로 신버전 YAML 임포트 시도).

```json
{ "details": { "yaml_version": "2", "current_max": "1" } }
```

---

### `OPENRAG_VERSION_MISMATCH`
**HTTP**: 200 (warning) / **Recoverable**: ✅
**발생**: 워크스페이스 공유 패키지 임포트 (P2).

다른 메이저 버전에서 만든 패키지. 호환성 보장 안 됨.

```json
{ "details": { "package_version": "0.9.0", "current_version": "1.2.0" } }
```

응답 본문은 200이고 `warnings` 배열에 포함 (전체 임포트 거부 아님).

---

### `VECTORS_NOT_INCLUDED`
**HTTP**: 200 (warning) / **Recoverable**: ✅
**발생**: 공유 패키지 임포트 시 벡터가 빠진 경우 (P2).

```json
{ "details": { "next_action_required": "reindex" } }
```

---

### `DUPLICATE_CONTENT_HASH`
**Note**: 에러 아닌 정상 케이스. 업로드 응답의 `skipped[]`에 표시되는 사유 코드.

---

## 10. 시스템·플랫폼 에러

### `PATH_TOO_LONG`
**HTTP**: 422 / **Recoverable**: ✅
**발생**: Windows에서 long path 미활성화 + 240자 초과 (PLATFORM.md §2.5).

```json
{ "code": "PATH_TOO_LONG",
  "message": "파일 경로가 너무 깁니다. Windows long path를 활성화하거나 경로를 단축하세요.",
  "recoverable": true,
  "details": { "path": "C:\\...", "length": 287, "limit": 260 } }
```

**UI 처리**: 시스템 설정 안내 링크 표시.

---

### `PATH_OUTSIDE_WORKSPACE`
**HTTP**: 400 / **Recoverable**: ❌

사용자 입력 경로가 워크스페이스 외부를 가리킴 (path traversal 방어, PLATFORM.md §2.4).

```json
{ "details": { "path": "../../etc/passwd" } }
```

---

### `INSTANCE_ALREADY_RUNNING`
**HTTP**: 409 / **Recoverable**: ❌
**발생**: 두 인스턴스 동시 실행 시도 (PLATFORM.md §5.4).

```json
{ "code": "INSTANCE_ALREADY_RUNNING",
  "message": "OpenRAG-Lab이 이미 실행 중입니다.",
  "recoverable": false,
  "details": { "existing_url": "http://127.0.0.1:8000", "pid": 12345 } }
```

---

### `PORT_UNAVAILABLE`
**HTTP**: 503 / **Recoverable**: ✅

지정된 포트가 사용 중이고 자동 시도 범위(8000~8019)도 모두 점유됨.

```json
{ "details": { "tried_ports": [8000, 8001, 8002] } }
```

---

### `OPERATION_CANCELLED`
**HTTP**: 200 / **Recoverable**: ❌
**발생**: 도메인 예외 `CancelledError` (사용자가 task cancel 호출).

에러보다는 정상 종료에 가까우므로 200으로 응답하는 것이 권장.

```json
{ "details": { "task_id": "task_xxx", "stage_at_cancellation": "embedding" } }
```

---

## 11. Deprecated

(현재 비어 있음. 추후 폐기되는 코드는 여기에 옮기고, 대체 코드를 명시한다.)

```
EXAMPLE:
  CODE_OLD → CODE_NEW (since v1.x.y, removed in v2.0.0)
```

---

## 12. 도메인 예외 ↔ 에러 코드 매핑

설계서 §9.1의 도메인 예외가 API 에러 코드로 어떻게 변환되는지의 매핑.

| 도메인 예외 | 기본 코드 | 비고 |
|---|---|---|
| `ParseError` | `PARSE_*` 중 하나 | 어댑터에서 구체화 |
| `ModelNotLoadedError` | `MODEL_NOT_LOADED` | 직접 매핑 |
| `OutOfMemoryError` | `OUT_OF_MEMORY` | 직접 매핑 |
| `CancelledError` | `OPERATION_CANCELLED` | HTTP 200 |
| `ConfigurationError` | `CONFIG_VALIDATION_FAILED` 또는 `BAD_REQUEST_FIELD` | 컨텍스트별 |
| `ExternalApiError` | `EXTERNAL_API_FAILED` | 직접 매핑 |
| `OpenRagError` (기타) | `INTERNAL_ERROR` | catch-all, 500 |

**규칙**: 어댑터·서비스에서 도메인 예외를 발생시키고, Application 레이어(FastAPI 미들웨어)가 위 매핑에 따라 HTTP 응답으로 변환.

---

## 13. 프런트 분기 가이드

전형적인 코드 분기 패턴.

```typescript
// 의사 코드
function handleApiError(error: ApiError) {
  switch (error.code) {
    // 자동 재시도 가능
    case "FILE_LOCKED":
    case "MODEL_DOWNLOAD_FAILED":
    case "EXTERNAL_API_FAILED":
      return showRetryToast(error);

    // 사용자에게 명시적 행동 요구
    case "MODEL_NOT_AVAILABLE_LOCALLY":
      return showDownloadModal(error.details.model_id);
    case "EMBEDDER_DIM_MISMATCH":
      return showReindexModal();
    case "PATH_TOO_LONG":
      return showLongPathHelp();
    case "PROXY_AUTH_REQUIRED":
      return showProxyAuthHelp(error.details);
    case "PROXY_TLS_VERIFICATION_FAILED":
      return showCaBundleHelp(error.details);

    // 진행 중 태스크로 안내
    case "INDEXING_IN_PROGRESS":
    case "WORKSPACE_BUSY":
      return navigateToTask(error.details.running_task_id);

    // 단순 정보 표시
    case "PARSE_ENCRYPTED_PDF":
    case "PARSE_CORRUPTED_FILE":
    case "PARSE_EMPTY_DOCUMENT":
      return showInlineFileError(error);

    // 페이지 이동
    case "WORKSPACE_NOT_FOUND":
      return redirectToWorkspaceList();

    // 검증 에러는 폼에 인라인
    case "BAD_REQUEST_FIELD":
    case "CONFIG_VALIDATION_FAILED":
      return showFormErrors(error.details);

    // 그 외
    default:
      return showGenericError(error);
  }
}
```

---

## 14. 테스트 시나리오

각 코드는 최소 하나의 단위·통합 테스트로 검증되어야 한다.

| 코드 | 테스트 위치 | 시나리오 |
|---|---|---|
| `PARSE_ENCRYPTED_PDF` | `tests/integration/parsers/test_pdf.py` | fixtures의 `encrypted.pdf` 업로드 |
| `CHUNK_SIZE_EXCEEDS_EMBEDDER_LIMIT` | `tests/unit/services/test_indexer.py` | small embedder + chunk_size 2048 |
| `INDEXING_IN_PROGRESS` | `tests/integration/api/test_indexing.py` | 인덱싱 진행 중 두 번째 호출 |
| `FILE_LOCKED` | `tests/integration/parsers/test_pdf.py` (Windows only) | 같은 파일을 다른 핸들로 잠근 상태 |
| `BACKEND_NOT_AVAILABLE` | `tests/unit/config/test_validate.py` | metal 명시 + 가짜 windows profile |
| `INSTANCE_ALREADY_RUNNING` | `tests/integration/system/test_lock.py` | runtime.lock 선점 |
| `PROXY_AUTH_REQUIRED` | `tests/integration/external/test_proxy.py` | fake 프록시가 407 응답 |
| `PROXY_TLS_VERIFICATION_FAILED` | `tests/integration/external/test_proxy.py` | 자체 서명 인증서 + ca_bundle 미지정 |

---

## 15. 변경 관리

- 새 코드 추가는 **PR 단위**로 본 문서 업데이트 필수.
- 기존 코드의 의미 변경 금지. 변경 필요 시 새 코드 + deprecation.
- 분기 인덱스(§2)와 매핑 표(§12)는 코드 추가 시 함께 갱신.
- API 명세서·CONFIG_SCHEMA·PLATFORM.md에서 코드를 인용할 때 본 문서 §X를 함께 링크.
