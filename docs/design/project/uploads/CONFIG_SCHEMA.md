# OpenRAG-Lab 설정 스키마 (CONFIG_SCHEMA.md v2)

> **이 문서의 위치**: 사용자가 직접 편집하거나 익스포트/임포트하는 **워크스페이스 설정 YAML**의 명세.
> **짝 문서**: API 명세서 §12 (`/config/export`, `/config/import`), 설계서 §5.1 (`ExperimentConfig`), PLATFORM.md (경로/백엔드).
> **독자**: 엔지니어 페르소나(설정을 손으로 편집하는 사용자), Claude Code (검증 로직 구현자).
> **이 문서가 다루지 않는 것**: API 응답 스키마, SQLite 스키마, 글로벌 설정(`settings.yaml`)은 별도.
> **변경 이력**:
> - v1→v2: 외부 LLM 4개 제공자 enum 명시 / `llm_id: null` (검색 전용 모드) 동작 명세 / `meta`에 라이선스 ID 기록.
> - v2→v3: 프록시·TLS 설정의 위치(글로벌 `settings.yaml`)를 §4.5에 명시 — 워크스페이스 YAML 비포함 정책.

---

## 1. 설계 원칙

설정 YAML은 다음 원칙을 만족한다.

1. **사람이 읽고 쓸 수 있어야 한다**. JSON Schema 같은 기계 친화 형식보다 주석·들여쓰기 친화적인 YAML.
2. **결정적 재현이 가능해야 한다**. 동일 YAML → 동일 fingerprint → 동일 결과 (설계서 §1, §5.1).
3. **모르는 필드는 무시하지 않고 거부**한다. 오타가 조용히 묻히지 않게.
4. **모든 필드에 기본값이 있다**. 최소한의 YAML로도 동작 가능.
5. **호환되지 않는 변경은 `version` 증가로 표시**한다. 자동 마이그레이션 가능 시 수행.

---

## 2. 최소 예시

가장 짧게 동작하는 워크스페이스 설정.

```yaml
version: "1"
workspace:
  name: "내 자료실"

config:
  embedder_id: "BAAI/bge-small-en-v1.5"
  chunking:
    strategy: "recursive"
    chunk_size: 512
  retrieval_strategy: "dense"
  top_k: 5
```

이 YAML로 임포트하면 명시되지 않은 필드는 §6의 기본값으로 채워진다.

---

## 3. 전체 예시 (모든 필드 명시)

```yaml
# OpenRAG-Lab 워크스페이스 설정
# 익스포트 / 임포트 시 사용. API §12 참조.

version: "1"

# 워크스페이스 메타데이터
workspace:
  name: "변호사 자료실"
  description: "임대차 분쟁 판례 검색용"   # optional
  tags: ["legal", "korean"]                # optional, 자유 텍스트

# 핵심 실험 설정 (= ExperimentConfig)
config:

  # 임베딩 모델
  embedder_id: "BAAI/bge-small-en-v1.5"
  # 명명 규칙:
  #   "<huggingface-org>/<model-name>"  - HF 허브에서 다운로드
  #   "local:<path>"                     - 로컬 GGUF/sentence-transformers 경로
  #   "external:<provider>:<model>"      - 외부 API (P1, 사전 등록 필요)

  # 청킹
  chunking:
    strategy: "recursive"     # fixed | recursive | sentence(P1) | semantic(P1)
    chunk_size: 512           # 토큰 단위
    chunk_overlap: 64         # 토큰 단위, 0 ≤ overlap ≤ chunk_size/2
    extra: {}                 # 전략별 추가 파라미터, §5.4 참조

  # 검색
  retrieval_strategy: "dense"  # dense | sparse(P1) | hybrid(P1)
  top_k: 5                     # 1 ≤ top_k ≤ 50
  reranker_id: null            # P2, 리랭커 사용 시 모델 ID

  # 답변 생성 LLM
  llm_id: "local:llama-3-8b-q4"
  # null이면 검색만 수행, 답변 생성 단계 생략

  # 평가용 Judge LLM
  judge_llm_id: null
  # null이면 llm_id를 그대로 사용. 다른 LLM을 평가에 쓰고 싶을 때 지정.

# 가속 백엔드 선호 (선택적)
acceleration:
  preferred: "auto"           # auto | cuda | metal | rocm | xpu | directml | cpu
  # "auto"는 PLATFORM.md §3.3의 자동 선택 로직을 따름.
  # 명시 시 해당 백엔드가 사용 불가하면 에러 (BACKEND_NOT_AVAILABLE).
  fallback_to_cpu: true       # 선호 백엔드 실패 시 CPU로 fallback할지

# 외부 호출 정책
external:
  allow_llm_api: false        # external:<provider>:* 를 llm_id에 사용 가능?
  allow_model_download: true  # HuggingFace에서 모델 자동 다운로드?
  allowed_providers: []       # ["openai", "anthropic"] 등. 빈 배열이면 외부 API 차단.

# 캐시 정책 (선택적, settings.yaml 글로벌 값 오버라이드)
cache:
  embedding_cache_enabled: true
  parse_cache_enabled: true

# 메타 (자동 채워짐, 사용자가 편집해도 무시됨)
meta:
  fingerprint: "fp_a1b2c3"     # config의 결정적 해시
  exported_at: "2026-04-27T11:00:00Z"
  exported_by: "openrag-lab v1.0.0"
  exported_from_os: "darwin"   # 기록용. 호환성 검사에 사용.
```

---

## 4. 필드 레퍼런스

### 4.1. 최상위

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `version` | string | ✅ | — | 스키마 버전. 현재 `"1"`. |
| `workspace` | object | ✅ | — | §4.2 참조. |
| `config` | object | ✅ | — | §4.3 참조. |
| `acceleration` | object |  | §6 기본값 | §4.4 참조. |
| `external` | object |  | §6 기본값 | §4.5 참조. |
| `cache` | object |  | §6 기본값 | §4.6 참조. |
| `meta` | object |  | 자동 | §4.7 참조. 사용자 편집 무시. |

### 4.2. `workspace`

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `name` | string | ✅ | — | 1~200자. 한글·이모지 허용. |
| `description` | string |  | `""` | 자유 텍스트, 길이 제한 없음. |
| `tags` | string[] |  | `[]` | 분류 태그. 각 태그 1~50자. |

### 4.3. `config` (= ExperimentConfig)

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `embedder_id` | string | ✅ | — | 임베딩 모델 ID. §5.1 명명 규칙. |
| `chunking` | object | ✅ | — | §4.3.1 참조. |
| `retrieval_strategy` | enum | ✅ | — | `dense` (P0) \| `sparse` (P1) \| `hybrid` (P1). |
| `top_k` | int | ✅ | — | 1~50. 검색 시 반환할 청크 수. |
| `reranker_id` | string | nullable | `null` | P2. 리랭커 모델 ID. |
| `llm_id` | string | nullable | `null` | §5.1 명명 규칙. **`null`이면 검색 전용 모드** (컨셉 §3.3.4): 답변 생성 단계 생략, 검색된 청크만 표시, LLM 의존 평가 지표(Faithfulness, Answer Relevance)는 산출되지 않음. |
| `judge_llm_id` | string | nullable | `null` | 평가용 LLM. `null`이면 `llm_id`를 사용 (`llm_id`도 `null`이면 LLM 의존 지표는 자동 비활성). |

#### 4.3.1. `config.chunking`

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `strategy` | enum | ✅ | — | `fixed` \| `recursive` \| `sentence`(P1) \| `semantic`(P1). |
| `chunk_size` | int | ✅ | — | 32~4096 토큰. |
| `chunk_overlap` | int |  | `0` | 0 ≤ overlap ≤ chunk_size/2. |
| `extra` | object |  | `{}` | 전략별 파라미터. §5.4. |

### 4.4. `acceleration`

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `preferred` | enum |  | `"auto"` | `auto` \| `cuda` \| `metal` \| `rocm` \| `xpu` \| `directml` \| `cpu`. |
| `fallback_to_cpu` | bool |  | `true` | 선호 백엔드 실패 시 CPU 폴백 여부. |

상세 동작은 PLATFORM.md §3.3.

### 4.5. `external`

외부 호출 정책. 컨셉 §1.2 프라이버시 가치를 보호하는 화이트리스트.

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `allow_llm_api` | bool |  | `false` | `external:<provider>:*` 형식 LLM ID 허용 여부. |
| `allow_model_download` | bool |  | `true` | HuggingFace 등에서 모델 자동 다운로드 허용. |
| `allowed_providers` | enum[] |  | `[]` | 허용 외부 LLM 제공자. 가능 값: `openrouter` \| `gemini` \| `openai` \| `anthropic`. 빈 배열이면 외부 차단. |

`allow_llm_api: true`이지만 `allowed_providers`가 비어 있으면 `EXTERNAL_PROVIDER_NOT_ALLOWED` 에러.

**사용 흐름** (API §15.0.5와 동일):
```
1. config에 external:openai:gpt-4o-mini 사용 명시
2. external.allow_llm_api: true 그리고 allowed_providers에 openai 포함
3. 글로벌 settings.yaml(또는 keystore)에 openai API 키 등록되어 있어야 함
4. 위 셋 중 하나라도 미충족 시 채팅·평가 호출이 실패
```

키 등록은 본 YAML이 아닌 별도 엔드포인트(API §15.0)에서 처리 (키를 워크스페이스 YAML에 저장하지 않음으로써 공유·익스포트 안전).

**프록시·TLS 설정도 본 워크스페이스 YAML에 두지 않는다.** 사내망 프록시 주소·CA 인증서 경로 등은 환경 의존 정보이므로 워크스페이스 익스포트·공유 시 함께 새어나가면 안 된다. 글로벌 `<OPENRAG_HOME>/settings.yaml`의 `network` 섹션에서 관리한다 — 스키마와 우선순위는 PLATFORM.md §11 참조.

### 4.6. `cache`

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `embedding_cache_enabled` | bool |  | `true` | 임베딩 캐시 사용. 끄면 항상 재계산. |
| `parse_cache_enabled` | bool |  | `true` | 파싱 결과 캐시 사용. |

캐시 키 구성은 설계서 §8.3.

### 4.7. `meta` (자동, 읽기 전용)

| 필드 | 타입 | 설명 |
|---|---|---|
| `fingerprint` | string | `config`의 결정적 해시. 임포트 시 검증용. |
| `exported_at` | ISO 8601 | 익스포트 시각. |
| `exported_by` | string | OpenRAG-Lab 버전. |
| `exported_from_os` | enum | `darwin` \| `windows` \| `linux`. 호환성 메모. |
| `model_licenses` | object | 사용 모델별 라이선스 ID. 받는 쪽이 호환성·의무사항 확인용. 컨셉 §9-4. |

`model_licenses` 예:
```yaml
meta:
  model_licenses:
    embedder:
      id: "MIT"
      acceptance_required: false
      commercial_use: "allowed"
    llm:
      id: "llama-3-community"
      acceptance_required: true
      commercial_use: "conditional"
```

사용자가 이 섹션을 편집해도 임포트 시 무시되고 자동으로 다시 계산된다.

---

## 5. 명명 규칙 (Naming Conventions)

### 5.1. `embedder_id`, `llm_id`, `judge_llm_id`, `reranker_id`

다음 세 형식 중 하나.

| 형식 | 예시 | 의미 |
|---|---|---|
| `<org>/<model>` | `BAAI/bge-small-en-v1.5` | HuggingFace 허브에서 자동 다운로드. |
| `local:<key>` | `local:llama-3-8b-q4` | 로컬 모델 카탈로그 키 (§5.2). |
| `external:<provider>:<model>` | `external:openai:gpt-4o-mini` | 외부 API. `external.allow_llm_api: true` 필수. |

**검증 규칙**:
- `external:` 형식은 `embedder_id`에 사용 불가 (임베딩은 차원 일관성을 위해 로컬만).
- `external:` 형식은 `reranker_id`에 사용 불가 (P2까지).
- `external:`의 `<provider>`는 `external.allowed_providers`에 포함되어야 함.

### 5.2. 로컬 모델 카탈로그 키

`local:<key>` 형식의 `<key>`는 `<OPENRAG_HOME>/models/catalog.json`에 정의된다 (P1 §15.1 모델 매니저).

MVP에서는 다음 사전 정의 키만 인식:
- `local:tinyllama-1.1b-q4`
- `local:llama-3-8b-q4`
- `local:qwen-7b-q4`

### 5.3. 워크스페이스 이름

- 길이 1~200자.
- 파일 시스템에 디렉토리로 매핑되지 않는다 (워크스페이스는 ID로 디렉토리화). 따라서 PLATFORM.md §4.5 금지 문자 제약을 받지 않는다.

---

## 6. 기본값 통합 (Default Resolution)

YAML이 누락한 필드는 다음 순서로 채워진다.

```
1. 본 문서의 명시된 기본값
2. 글로벌 settings.yaml의 값 (있는 경우)
3. 임베더의 권장값 (예: chunk_size 권장)
```

**전체 기본값**:

```yaml
version: "1"
workspace:
  description: ""
  tags: []
config:
  chunking:
    chunk_overlap: 0
    extra: {}
  reranker_id: null
  llm_id: null
  judge_llm_id: null
acceleration:
  preferred: "auto"
  fallback_to_cpu: true
external:
  allow_llm_api: false
  allow_model_download: true
  allowed_providers: []
cache:
  embedding_cache_enabled: true
  parse_cache_enabled: true
```

---

## 7. 검증 규칙

임포트 시 다음 순서로 검증한다.

### 7.1. 구조 검증

- [ ] `version` 필드 존재 및 알려진 버전 (현재 `"1"`).
- [ ] 필수 필드 (§4.1, §4.2, §4.3 표의 ✅) 모두 존재.
- [ ] 알 수 없는 필드 없음 (오타 방지). 있으면 `UNKNOWN_FIELD` 에러.

### 7.2. 타입·범위 검증

- [ ] 각 필드의 타입 일치.
- [ ] enum 값이 허용 목록에 포함.
- [ ] 정수 범위 (예: `top_k`는 1~50, `chunk_size`는 32~4096).
- [ ] `chunk_overlap` ≤ `chunk_size / 2`.

### 7.3. 의미 검증

- [ ] `chunk_size`가 `embedder_id`의 `max_tokens`를 초과하지 않음 → 위반 시 `CHUNK_SIZE_EXCEEDS_EMBEDDER_LIMIT`.
- [ ] `external:` 형식 사용 시 `external.allow_llm_api: true` 그리고 provider가 `allowed_providers`에 포함.
- [ ] `acceleration.preferred`가 `auto`가 아니면 PLATFORM.md §3.1의 매트릭스에서 현재 OS·하드웨어에 가용한 백엔드인지 확인.
- [ ] `embedder_id`에 `external:` 형식 사용하지 않았는지.

### 7.4. 호환성 검증

- [ ] `meta.exported_from_os`와 현재 OS가 다를 때 다음 경고:
  - 다른 OS에서 익스포트된 경우 `acceleration.preferred`가 현재 OS에서 사용 불가능하면 자동으로 `auto`로 변경하고 warning.
- [ ] `meta.exported_by`의 OpenRAG-Lab 버전이 메이저 다른 경우 `OPENRAG_VERSION_MISMATCH` warning.

### 7.5. 검증 에러 응답

API §12.2 임포트 실패 시:

```json
{
  "error": {
    "code": "CONFIG_VALIDATION_FAILED",
    "message": "설정 검증 실패",
    "recoverable": true,
    "details": {
      "errors": [
        {
          "path": "config.chunking.chunk_size",
          "code": "VALUE_OUT_OF_RANGE",
          "message": "chunk_size는 32~4096 범위여야 합니다 (현재: 8192)"
        },
        {
          "path": "config.embedder_id",
          "code": "UNKNOWN_FIELD",
          "message": "알 수 없는 필드: 'embeder_id' (오타?)"
        }
      ]
    }
  }
}
```

여러 에러를 한 번에 모아 반환한다 (사용자가 한 번에 고칠 수 있게).

---

## 8. 페르소나별 권장 설정

### 8.1. 일반 사용자 — Auto-Pilot 사용 (지수)

**권장**: 설정 파일 직접 편집 안 함. UI의 프리셋 선택만 사용.

만약 익스포트한 YAML을 보면 다음과 비슷할 것:

```yaml
version: "1"
workspace:
  name: "내 자료실"
config:
  embedder_id: "BAAI/bge-small-en-v1.5"
  chunking:
    strategy: "recursive"
    chunk_size: 512
    chunk_overlap: 64
  retrieval_strategy: "dense"
  top_k: 5
  llm_id: "local:llama-3-8b-q4"
acceleration:
  preferred: "auto"
external:
  allow_llm_api: false
```

### 8.2. RAG 학습자 — 비교 실험 (민호)

**권장**: 같은 워크스페이스에 여러 청크 크기로 인덱싱하며 YAML을 손으로 바꿔가며 실험.

```yaml
version: "1"
workspace:
  name: "RAG 실험실"
  tags: ["learning"]
config:
  embedder_id: "BAAI/bge-small-en-v1.5"
  chunking:
    strategy: "recursive"
    chunk_size: 256        # ← 256 / 512 / 1024로 바꿔가며 실험
    chunk_overlap: 32
  retrieval_strategy: "dense"
  top_k: 5
  llm_id: "local:tinyllama-1.1b-q4"  # 빠른 반복을 위해 가벼운 모델
cache:
  embedding_cache_enabled: true       # 청크 안 바뀐 부분은 재사용
```

### 8.2.1. RAG 학습자 — 검색 성능만 측정 (민호의 변형 시나리오)

**목적**: LLM 변수를 빼고 임베더만 비교하고 싶을 때. 컨셉 §3.3.4 검색 전용 모드.

```yaml
version: "1"
workspace:
  name: "임베더 비교"
  description: "bge-small vs all-MiniLM 검색 성능만 측정"
config:
  embedder_id: "BAAI/bge-small-en-v1.5"   # 또는 "sentence-transformers/all-MiniLM-L6-v2"
  chunking:
    strategy: "recursive"
    chunk_size: 512
    chunk_overlap: 64
  retrieval_strategy: "dense"
  top_k: 10
  llm_id: null              # ← 핵심: 검색 전용 모드 활성화
external:
  allow_model_download: true
```

이 설정으로 인덱싱·검색·평가하면 Context Precision/Recall만 산출되고 답변 생성 단계는 생략된다. 두 임베더의 검색 품질을 LLM 변수 없이 직접 비교 가능.

### 8.3. 엔지니어 — 운영 배포 (수진)

**권장**: 매트릭스 평가로 최적 조합 찾은 뒤 그 YAML을 그대로 운영 환경 PC로 이식.

```yaml
version: "1"
workspace:
  name: "사내 매뉴얼 RAG"
  description: "사내 1만 페이지 매뉴얼. exp_005 채택 (faithfulness 0.91)"
  tags: ["production", "internal-docs"]
config:
  embedder_id: "BAAI/bge-large-en-v1.5"
  chunking:
    strategy: "recursive"
    chunk_size: 768
    chunk_overlap: 96
  retrieval_strategy: "hybrid"          # P1
  top_k: 8
  reranker_id: "BAAI/bge-reranker-base" # P2
  llm_id: "local:llama-3-8b-q4"
  judge_llm_id: "external:openai:gpt-4o-mini"  # 평가만 외부 LLM
acceleration:
  preferred: "cuda"                     # 명시적 (NVIDIA 서버 환경)
  fallback_to_cpu: false                # CPU 폴백 시 너무 느려서 차라리 에러
external:
  allow_llm_api: true
  allowed_providers: ["openai"]
  allow_model_download: false           # 운영 환경에서는 모델 추가 다운로드 차단
```

---

## 9. 흔한 편집 시나리오

### 9.1. 청크 크기만 바꾸기

```yaml
config:
  chunking:
    chunk_size: 768       # 512 → 768
    # 나머지는 그대로
```

임포트 시: `requires_reindex: true`. 임베딩 캐시는 청킹 키가 바뀌어 무효화.

### 9.2. 임베딩 모델 교체

```yaml
config:
  embedder_id: "BAAI/bge-large-en-v1.5"   # small → large
```

임포트 시: `requires_reindex: true`. 차원이 달라져 기존 벡터 호환 불가. 사용자에게 명시적 확인 요청 (설계서 §13-4).

### 9.3. 외부 LLM 활성화

```yaml
config:
  llm_id: "external:openai:gpt-4o-mini"
external:
  allow_llm_api: true
  allowed_providers: ["openai"]
```

임포트 시: API 키가 글로벌 `settings.yaml`에 등록되어 있는지 확인. 없으면 `EXTERNAL_API_KEY_MISSING` 에러.

### 9.4. 다른 OS로 이식

macOS에서 `acceleration.preferred: metal`로 익스포트한 YAML을 Windows에서 임포트:

```
WARNING: 'metal' 백엔드는 현재 OS(windows)에서 사용 불가능합니다.
         'auto'로 변경되었습니다. 다시 익스포트하면 'cuda'(NVIDIA 환경) 또는 'cpu'로 기록됩니다.
```

`fallback_to_cpu: true`이면 자동 처리, `false`이면 `BACKEND_NOT_AVAILABLE` 에러.

---

## 10. 버전 마이그레이션

### 10.1. 현재 버전

`"1"` (MVP 출시 시).

### 10.2. 마이그레이션 정책

- `version`이 현재 버전보다 낮으면 자동 마이그레이션 시도.
- 자동 마이그레이션 불가능한 변경 (필드 의미 변경, 필수 필드 추가)은 사용자에게 명시적 안내.
- `version`이 현재보다 높으면 `CONFIG_VERSION_TOO_NEW` 에러 (구버전 OpenRAG-Lab으로 신버전 YAML 임포트 시도).

### 10.3. 호환성 보증

- 같은 메이저 버전 내 (`1.x` ↔ `1.y`)는 항상 호환.
- 메이저 버전이 올라가면 마이그레이션 스크립트 제공.

---

## 11. 관련 도구

### 11.1. CLI 검증

```bash
openrag-lab config validate path/to/config.yaml
```

YAML을 임포트하지 않고 검증만 수행. CI나 사전 점검용.

### 11.2. 차이 비교

```bash
openrag-lab config diff old.yaml new.yaml
```

두 설정의 fingerprint 차이와 영향 분석 (재인덱싱 필요 여부 등).

### 11.3. fingerprint 계산

```bash
openrag-lab config fingerprint path/to/config.yaml
```

`config` 섹션의 결정적 해시만 출력. CI에서 "이 설정이 이미 실험된 것인지" 확인용.

> 위 CLI 명령은 P1 범위. MVP에서는 API의 `/config/import?dry_run=true` (P1로 추가될 옵션)로 대체.

---

## 12. 변경 관리

- 본 문서가 정의한 스키마는 API 명세서 §12와 짝을 이룬다. 한쪽 변경 시 다른 쪽도 갱신.
- 새 필드 추가는 minor 변경 (기존 YAML 그대로 호환).
- 필드 의미 변경·필수 필드 추가는 major 변경 → `version` 증가 + 마이그레이션 스크립트 작성.
- 모든 스키마 변경은 §10에 변경 이력 기록.
