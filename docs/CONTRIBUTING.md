# CONTRIBUTING.md (v1)

> **이 문서의 위치**: OpenRAG-Lab의 작업 컨벤션. **Claude Code가 작업하기 전에 반드시 읽어야 할 룰**이자, 사람 기여자에게도 적용.
> **짝 문서**: 컨셉 v3, 설계서 v2, API 명세서 v3, PLATFORM.md, CONFIG_SCHEMA.md, ERROR_CODES.md.
> **우선순위**: 본 문서는 절차·스타일을 다룬다. 구조·인터페이스 결정은 다른 문서가 우선.

---

## 0. 황금률 (Read First)

작업 시작 전에 다음을 머릿속에 새긴다.

1. **모르면 묻고, 추측하지 않는다.** 결정 보류 사항(컨셉 §9, 설계서 §13)에 해당하는 사안이 닿으면 그 결정을 먼저 받아낸다.
2. **단일 진실 공급원(SSoT)을 존중한다.** OS·경로·백엔드는 PLATFORM.md, 에러 코드는 ERROR_CODES.md, YAML은 CONFIG_SCHEMA.md. 다른 문서는 이를 인용만 한다.
3. **금지사항을 어기지 않는다.** §3에 명시. 한 번 어기면 보통 큰 재작업이 따른다.
4. **수직 슬라이스로 일한다.** 한 기능을 끝까지 (도메인 → 어댑터 → API → 테스트) 완성하고 다음으로 넘어간다. 모든 어댑터를 먼저 만들고 도메인을 붙이는 식의 광범위한 폭넓은 작업은 피한다.
5. **MVP는 2-4주.** 컨셉 §7 MVP 범위 표를 항상 참조한다. P1·P2 기능을 P0에 끼워넣지 않는다.

---

## 1. 시작하기 전 체크리스트

새 작업(이슈, PR, 큰 변경)에 착수하기 전 다음을 확인한다.

- [ ] 컨셉 v3에서 이 작업이 P0인가, P1인가, P2인가 식별
- [ ] 설계서 v2의 어느 모듈(들)을 건드리는가 파악
- [ ] PLATFORM.md에서 OS별 분기가 필요한가 확인
- [ ] 변경할 API가 있다면 API 명세서 v3에 정의되어 있는가
- [ ] 새 에러 코드가 필요한가 (있으면 ERROR_CODES.md에 먼저 추가)
- [ ] 기존 코드가 의존성 방향(설계서 §3.2)을 따르는지 위반 여부 검증

---

## 2. 모듈 경계 (가장 자주 깨지는 룰)

설계서 §3.1·§4.1의 레이어 구조를 강제한다. **이 절은 Claude Code가 자동으로 어기기 쉬운 곳이라 강하게 명시한다.**

### 2.1. 의존성 방향

```
UI / Frontend
    ↓
app/ (Application: FastAPI, WebSocket)
    ↓
domain/ (비즈니스 로직, 외부 라이브러리 import 금지)
    ↑ (Protocol/ABC 인터페이스)
adapters/ (외부 라이브러리를 도메인 인터페이스로 감쌈)
    ↓
infra/ (DB, FS, OS) | 외부 라이브러리 (sentence_transformers, chromadb 등)
```

화살표는 한 방향만. **`domain/`이 위쪽(`app/`, `adapters/`, `infra/`)을 import하면 즉시 잘못된 코드.**

### 2.2. `domain/`에서 절대 금지

- ❌ `import sentence_transformers`
- ❌ `import chromadb`
- ❌ `import llama_cpp`
- ❌ `import fastapi`
- ❌ `import sqlite3` 또는 `from sqlalchemy ...`
- ❌ `from pathlib import Path` 외의 OS 의존 코드
- ❌ `if sys.platform == "win32"`

### 2.3. `domain/`에서 허용

- ✅ Python 표준 라이브러리 (`pathlib`, `dataclasses`, `enum`, `datetime`, `hashlib`, `typing`, `asyncio`)
- ✅ `numpy` (벡터 타입 표현용. 도메인의 일부로 간주)
- ✅ `pydantic` (타입 검증용. 같은 이유)
- ✅ 다른 `domain/` 모듈
- ✅ `from domain.ports.* import ...` (자기 자신의 인터페이스)

### 2.4. 자동 검증

다음 중 하나를 CI에서 강제한다.

```bash
# 옵션 A: import-linter
pip install import-linter
lint-imports --config .importlinter

# 옵션 B: ruff의 flake8-tidy-imports
ruff check backend/domain/ --select TID
```

`.importlinter` 예시 (실제 룰은 `tools/import_rules.toml`에 둔다):

```toml
[importlinter]
root_package = "openrag_lab"

[[importlinter.contracts]]
name = "Domain must not import infrastructure"
type = "forbidden"
source_modules = ["openrag_lab.domain"]
forbidden_modules = [
    "openrag_lab.adapters",
    "openrag_lab.infra",
    "openrag_lab.app",
    "sentence_transformers",
    "chromadb",
    "llama_cpp",
    "fastapi",
]
```

PR이 이 검증을 통과하지 않으면 머지 불가.

---

## 3. 절대 금지 사항 (Hard No)

다음은 어떤 이유로도 허용되지 않는다.

### 3.1. 도메인 코드의 OS 분기

```python
# ❌ domain/services/indexer.py
if sys.platform == "win32":
    ...
```

OS 분기는 `adapters/` 또는 `infra/`에만. 도메인은 OS를 모른다 (PLATFORM.md, 설계서 §1).

### 3.2. 경로 문자열 결합

```python
# ❌
path = workspace_root + "/cache/" + doc_id

# ✅
path = workspace_root / "cache" / doc_id
```

`pathlib.Path`만 사용 (PLATFORM.md §2.4).

### 3.3. 에러 코드 즉석 생성

```python
# ❌
raise HTTPException(status_code=400, detail={"code": "SOMETHING_WRONG", "msg": "..."})

# ✅
# ERROR_CODES.md에 먼저 등록한 후
raise ParseError(code="PARSE_CORRUPTED_FILE", details={"filename": fn})
# Application 레이어에서 ERROR_CODES.md §12 매핑에 따라 HTTP로 변환
```

### 3.4. 동기 I/O를 async 함수에서

```python
# ❌
async def parse(self, doc):
    text = open(doc.path).read()  # 이벤트 루프 막힘

# ✅
async def parse(self, doc):
    text = await asyncio.to_thread(self._read_sync, doc.path)
```

장기 I/O·CPU 바운드는 `asyncio.to_thread` 또는 `run_in_executor`로 격리.

### 3.5. 프린트·임시 로그 잔존

```python
# ❌
print("DEBUG: chunk created", chunk)
```

구조화 로깅(`structlog` 또는 stdlib `logging`)만 사용. PR 머지 전 모든 print 제거.

### 3.6. `# type: ignore`, `Any` 남용

타입 검증을 우회하지 않는다. 외부 라이브러리 타입 부족 시 `cast()` 또는 어댑터 내부에 `# type: ignore[<rule>]`로 한정 사용 가능. 도메인 코드에서는 금지.

### 3.7. 비밀 정보의 로그·에러 노출

API 키, 사용자 파일 내용, 절대 경로 등이 로그·에러 메시지에 들어가지 않게 한다. 경로는 워크스페이스 상대로, 키는 마지막 4자리만 노출.

### 3.8. 단일 PR에서 여러 기능 혼합

한 PR은 한 가지 변경. 리팩터링과 기능 추가를 섞지 않는다.

---

## 4. 추천 패턴 (Hard Yes)

### 4.1. 새 어댑터 작성 흐름

```
1. domain/ports/ 에서 인터페이스 확인 (있으면 사용, 없으면 추가)
2. adapters/<area>/<name>.py 에 구현
3. tests/integration/adapters/<area>/test_<name>.py 에 통합 테스트
4. PLATFORM.md §9 어댑터 체크리스트 통과 확인
5. 의존성 주입 위치(보통 FastAPI dependency)에 등록
```

### 4.2. 새 엔드포인트 추가 흐름

```
1. API 명세서 v3 §3에 경로·용도 추가
2. API 명세서 §X에 요청·응답 본문 정의
3. 새 에러 코드 필요 시 ERROR_CODES.md에 추가
4. backend/app/api/<area>.py 에 라우트 구현
5. tests/integration/api/test_<area>.py
6. 프런트엔드 클라이언트 타입은 OpenAPI 자동 생성
```

### 4.3. 새 에러 코드 추가 흐름

```
1. ERROR_CODES.md §1.3 절차 따라 추가
2. 도메인 예외와 매핑 (§12)
3. Application 레이어 미들웨어가 매핑 적용
4. 단위 테스트로 트리거 시나리오 검증 (ERROR_CODES.md §14)
```

### 4.4. 새 OS 의존 처리 추가 흐름

```
1. PLATFORM.md 해당 절(경로·잠금·백엔드 등)에 정책 추가
2. infra/ 또는 adapters/ 안에서 OS 분기 구현
3. tests/fixtures/posix/ 또는 windows/ 에 fixture 추가
4. CI 매트릭스(PLATFORM.md §8.1)가 모두 통과하는지 확인
```

---

## 5. 코드 스타일

### 5.1. Python

| 항목 | 정책 |
|---|---|
| 포매터 | `ruff format` (`black` 호환) |
| 린터 | `ruff check` (룰셋: E, F, I, B, UP, N, S, C4, ASYNC, RUF) |
| 타입 체커 | `mypy --strict` for `domain/`, `--strict-optional` for the rest |
| 포매팅 적용 범위 | `backend/`, `tools/`, `tests/` 모두 |
| 라인 길이 | 100자 |
| Docstring | Google 스타일. 도메인의 모든 public class/function은 필수 |

### 5.2. TypeScript

| 항목 | 정책 |
|---|---|
| 포매터 | `prettier` |
| 린터 | `eslint` (`@typescript-eslint/strict-type-checked`) |
| 타입 체커 | `tsc --noEmit` |
| 컴포넌트 | 함수 컴포넌트만. 클래스 금지 |
| 상태 | Zustand 슬라이스 (설계서 §8.2) |

### 5.3. 네이밍

| 종류 | 규칙 | 예 |
|---|---|---|
| 모듈·파일 | snake_case | `chunking_config.py` |
| 클래스 | PascalCase | `ChunkingConfig` |
| 함수·변수 | snake_case | `embed_documents` |
| 상수 | UPPER_SNAKE | `MAX_CHUNK_SIZE` |
| TypeScript 컴포넌트 | PascalCase | `ChunkingLab.tsx` |
| TypeScript 훅 | `use` prefix | `useExperiment` |
| 에러 코드 | UPPER_SNAKE | `PARSE_ENCRYPTED_PDF` |

### 5.4. Async 컨벤션

- 도메인 서비스의 public 메서드는 기본 `async`.
- 같은 메서드의 동기 버전을 만들지 않는다 (둘 다 유지하는 비용 큼).
- CPU 바운드는 `asyncio.to_thread`. 동기 코드를 그대로 호출 금지.

### 5.5. Comment

- "무엇"이 아닌 "왜"를 쓴다.
- TODO에는 GitHub 이슈 번호 또는 결정 보류 사항 항목 명시: `# TODO(#42): ...` 또는 `# TODO(컨셉 §9-1): ...`.
- 코멘트보다 코드 자체가 명확한 게 우선. 코멘트가 많이 필요하면 함수 분리 검토.

---

## 6. 테스트

### 6.1. 비중

설계서 §10.1을 따른다. **단위 60%, 통합 25%, API 10%, E2E 5%.**

### 6.2. 새 코드의 최소 테스트 요구

| 추가한 것 | 필수 테스트 |
|---|---|
| 도메인 서비스 메서드 | 단위 테스트 (fake adapter 주입) |
| 어댑터 구현 | 통합 테스트 (실제 라이브러리 사용) |
| API 엔드포인트 | API 테스트 (`httpx.AsyncClient`) |
| 에러 코드 | 트리거 시나리오 단위 테스트 (ERROR_CODES.md §14) |
| OS 의존 코드 | 해당 OS의 fixture 사용 + skipif marker |

### 6.3. Fixture 위치

PLATFORM.md §8.3을 따른다.

```
backend/tests/fixtures/
├── common/
├── posix/
└── windows/
```

`pytest.mark.skipif(sys.platform == "win32")` 등을 명시적으로 사용.

### 6.4. 결정성 테스트

설계서 §1-3 결정적 재현 원칙 검증을 위한 테스트가 적어도 다음 위치에 있어야 한다.

- `tests/unit/models/test_chunking_config.py`: 같은 설정 → 같은 cache_key.
- `tests/unit/models/test_experiment_config.py`: 같은 설정 → 같은 fingerprint.
- `tests/integration/services/test_pipeline_replay.py`: 같은 YAML → 같은 점수 (작은 규모).

### 6.5. 테스트 명명

```python
def test_<주체>_<상황>_<기대>():
    ...

# 예
def test_chunker_recursive_strategy_respects_chunk_overlap():
    ...
def test_indexer_skips_documents_with_cache_hit():
    ...
def test_pdf_parser_raises_parse_encrypted_pdf_for_password_protected_file():
    ...
```

---

## 7. Git 워크플로우

### 7.1. 브랜치

```
main                    # 항상 동작 (CI green)
feat/<short-name>       # 새 기능
fix/<short-name>        # 버그 수정
docs/<short-name>       # 문서만
refactor/<short-name>   # 리팩터링 (기능 변경 없음)
chore/<short-name>      # 빌드·CI·도구
```

### 7.2. 커밋 메시지 (Conventional Commits)

```
<type>(<scope>): <subject>

[body]

[footer]
```

| type | 사용처 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 변경 |
| `refactor` | 리팩터링 |
| `test` | 테스트 추가·수정 |
| `chore` | 빌드·도구·CI |
| `perf` | 성능 개선 |

scope는 모듈명(`domain`, `adapters`, `api`, `frontend`, `platform` 등) 또는 문서명.

**예시**:
```
feat(domain): add ChunkingConfig.cache_key for deterministic caching
fix(adapters/pdf): handle encrypted PDFs with PARSE_ENCRYPTED_PDF
docs(error-codes): add MATRIX_TOO_LARGE for batch evaluation
refactor(api): extract pagination into common dependency
chore(ci): add macOS arm64 to test matrix
```

### 7.3. PR 규칙

- **제목**: 커밋 메시지 컨벤션 따름.
- **본문**: 다음 항목을 채운다.
  - 무엇을 변경했는가 (1~3줄)
  - 왜 (관련 문서·이슈 링크)
  - 영향 범위 (어느 모듈, OS별 차이 있는가)
  - 테스트 (추가한 테스트, 수동 검증 절차)
- **체크리스트**:
  - [ ] CI 통과 (3개 OS)
  - [ ] 의존성 방향 검증 통과
  - [ ] 관련 문서 업데이트
  - [ ] 새 에러 코드 ERROR_CODES.md 등록
  - [ ] 결정 보류 사항 건드리지 않았거나 사전 결정됨
- **크기**: 가능한 한 작게. 500줄 이상 PR은 분할 검토.

### 7.4. 리뷰

- 머지에는 한 명 이상의 승인 필요 (Claude Code 작업이라도 사람이 검토).
- 자동화된 검사 통과 필수.
- 의존성 방향·금지 사항 위반은 차단(blocker), 스타일은 권고(suggestion).

---

## 8. 문서 업데이트 규칙

### 8.1. 어떤 변경이 어느 문서를 건드리는가

| 변경 종류 | 갱신할 문서 |
|---|---|
| 새 P0/P1/P2 기능 추가 | 컨셉, 설계서, API |
| API 엔드포인트 추가·변경 | API 명세서 |
| 도메인 모델 추가 | 설계서 §5 |
| 어댑터 인터페이스 변경 | 설계서 §7 |
| 새 에러 코드 | ERROR_CODES.md, 그리고 인용한 문서 |
| 새 YAML 필드 | CONFIG_SCHEMA.md |
| OS 정책 변경 | PLATFORM.md (먼저), 그 후 다른 문서 동기화 |
| 작업 컨벤션 변경 | 본 문서 |

### 8.2. 충돌 시 우선순위

```
PLATFORM.md  >  CONFIG_SCHEMA.md  >  컨셉  >  설계서  >  API 명세서
ERROR_CODES.md (에러 코드 한정)
CONTRIBUTING.md (절차 한정)
```

다른 문서가 이를 어기게 작성되어 있으면 **본 문서에 우선해서 다른 문서를 고친다**.

### 8.3. 변경 이력

각 문서의 머리말에 `변경 이력` 항목을 두고, major 변경 시 한 줄씩 추가.

---

## 9. 보안·개인정보

### 9.1. 외부 호출의 투명성

컨셉 §1.2의 프라이버시 가치를 코드 차원에서 강제.

- 모든 외부 HTTP 호출은 `infra/external/` 모듈을 통한다.
- 해당 모듈은 호출 발생을 WebSocket `external_call` 이벤트로 발행.
- UI는 이를 상태 표시줄에 노출.

### 9.2. 비밀 관리

- API 키는 `<OPENRAG_HOME>/settings.yaml`에 저장. 권한 600.
- 환경변수 우선: `OPENRAG_OPENAI_API_KEY` 등.
- 절대 코드·로그·테스트 fixture에 키 하드코딩 금지.
- 로그에 키가 들어가는지 자동 검사 (CI에 `gitleaks` 또는 동등 도구).

### 9.3. 사용자 데이터 처리

- 워크스페이스의 문서 내용은 워크스페이스 외부로 나가지 않는다.
- 텔레메트리·크래시 리포트가 추가될 경우(P1) 사용자 동의 필수, 데이터 종류·전송처 명시.

---

## 10. 성능 가이드

### 10.1. 우선순위

```
정확성  >  명확성  >  성능
```

성능 최적화는 측정 후. 감으로 최적화 금지. 설계서 §3.4.4 프로파일러로 측정.

### 10.2. 비용이 큰 작업의 룰

- **임베딩 배치**: 한 번에 너무 큰 배치 금지 (OOM). 적응형 배치 크기 (`infra/cache/embedding_cache.py`).
- **벡터 검색**: ChromaDB의 메타데이터 필터를 적극 활용. 풀 스캔 금지.
- **LLM 호출**: 프롬프트 길이를 컨텍스트 윈도우 80% 이하로 제한. 초과 시 명시적 truncation.
- **파일 I/O**: 한 번에 큰 파일을 메모리에 올리지 않는다. 스트리밍.

### 10.3. 측정 위치

`@profile` 데코레이터(설계서 §3.4.4)를 도메인 서비스 public 메서드에 부착. 결과는 실험의 `PerformanceProfile`에 기록.

---

## 11. Claude Code 사용 가이드

본 문서는 사람과 Claude Code 모두에게 적용되지만, Claude Code에 작업을 시킬 때 특별히 권장되는 패턴.

### 11.1. 작업 단위 잘게 자르기

설계서 §12 간트 차트의 한 박스 단위를 권장. 한 PR에 여러 박스를 끼워넣지 않는다.

### 11.2. 컨텍스트 제공

작업 지시 시 함께 제공:
- 본 문서
- 관련 도메인의 컨셉·설계서·API 명세서 해당 절
- 건드리는 파일들의 현재 내용

### 11.3. 검증 요청

작업 완료 후 다음을 명시적으로 확인 요청:
- "의존성 방향 검증 통과했는가?"
- "ERROR_CODES.md에 누락 없이 등록했는가?"
- "PLATFORM.md §9 체크리스트 모두 만족하는가?"
- "테스트 작성·통과했는가?"

### 11.4. 의심스러우면 묻기

Claude Code가 추측으로 결정 보류 사항을 채우지 않게 한다. 작업 지시에 다음 안내를 포함:
> "이 작업이 컨셉 §9 또는 설계서 §13의 결정 보류 사항에 해당하면, 코드를 작성하지 말고 어떤 결정이 필요한지 질문하라."

---

## 12. 변경 관리

본 문서 자체의 변경:

- 룰 추가는 minor.
- 룰 강화·금지 사항 추가는 major (전체 코드베이스에 영향 미칠 수 있어 별도 PR로).
- 머리말에 `변경 이력` 한 줄씩 추가.
- 본 문서를 변경하면 README의 "기여 안내" 링크가 여전히 유효한지 확인.
