# CLAUDE.md

> **이 문서의 위치**: Claude Code (또는 다른 AI 코딩 에이전트)가 본 저장소에서 작업을 시작할 때 **가장 먼저 자동으로 읽는 문서**.
> **목적**: 9개 문서를 다 읽기 전에 알아야 할 핵심을 1~2분 분량으로 압축.
> **인간 독자**: 이 문서는 AI 에이전트용이지만, 사람이 읽어도 프로젝트의 룰을 빠르게 파악할 수 있다. 처음 합류하는 사람은 본 문서 → README.md → CONTRIBUTING.md 순으로 읽으면 좋다.

---

## 🛑 작업 시작 전 — 반드시 읽을 것

본 저장소는 **설계 명세 단계**다. 코드는 아직 없다. 명세 문서가 9개 있고, 그 룰을 따르는 것이 너의 첫 임무다.

### 황금률 5가지

1. **모르면 묻고, 추측하지 않는다.** 결정 보류 사항이 닿으면 결정을 먼저 받아낸다.
2. **단일 진실 공급원(SSoT)을 존중한다.** OS·경로·백엔드는 PLATFORM.md, 에러 코드는 ERROR_CODES.md, YAML은 CONFIG_SCHEMA.md.
3. **금지사항을 어기지 않는다.** §3에 명시. 한 번 어기면 큰 재작업이 따른다.
4. **수직 슬라이스로 일한다.** 한 기능을 끝까지(도메인→어댑터→API→테스트) 완성하고 다음으로.
5. **MVP 2-4주 범위만.** 컨셉 v4 §7 표 외 기능은 P0에 끼워넣지 않는다.

---

## 📂 문서 인덱스 — 우선순위 순

작업에 따라 다음 문서를 함께 본다.

### 모든 작업에 공통

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — 작업 컨벤션·금지사항·PR 룰. 본 문서를 보강한다.
- **[REQUIREMENTS_v4.md](./REQUIREMENTS_v4.md)** — 무엇을 만드는가 (P0/P1/P2).

### 백엔드·도메인 작업

- **[ARCHITECTURE_v3.md](./ARCHITECTURE_v3.md)** — 아키텍처, 모듈 구조, 어댑터 인터페이스.
- **[PLATFORM.md](./PLATFORM.md)** — OS·경로·GPU 백엔드 처리.

### API·인터페이스 작업

- **[API_SPEC_v4.md](./API_SPEC_v4.md)** — REST + WebSocket 계약.
- **[ERROR_CODES.md](./ERROR_CODES.md)** — 에러 코드 카탈로그 (46개).

### 설정·검증 작업

- **[CONFIG_SCHEMA.md](./CONFIG_SCHEMA.md)** — 워크스페이스 YAML 스키마.

### 충돌 시 우선순위

```
PLATFORM.md > CONFIG_SCHEMA.md > ERROR_CODES.md (도메인 한정)
            > 컨셉 v4 > 설계서 v3 > API v4
```

---

## 🚫 절대 금지 (Hard No)

다음을 어기면 PR이 차단된다. 자세한 내용·이유는 CONTRIBUTING.md §3.

### 1. `domain/`에서 외부 라이브러리 import

```python
# ❌ 절대 금지
# domain/services/indexer.py
import sentence_transformers
import chromadb
import llama_cpp
import fastapi
import sqlite3
```

도메인은 어댑터 인터페이스(`domain/ports/`)만 알아야 한다. 외부 라이브러리는 `adapters/` 안에서만.

### 2. 도메인 코드의 OS 분기

```python
# ❌
if sys.platform == "win32":
    ...
```

OS 분기는 `adapters/` 또는 `infra/`에만. PLATFORM.md가 정한 정책을 따른다.

### 3. 경로 문자열 결합

```python
# ❌
path = workspace_root + "/cache/" + doc_id
# ✅
path = workspace_root / "cache" / doc_id
```

`pathlib.Path`만 사용.

### 4. 즉석 에러 코드 생성

```python
# ❌
raise HTTPException(detail={"code": "SOMETHING_WRONG"})
# ✅
# ERROR_CODES.md에 먼저 등록 후 도메인 예외로 발생
raise ParseError(code="PARSE_CORRUPTED_FILE", details={...})
```

### 5. 동기 I/O를 async 함수에서

```python
# ❌
async def parse(self, doc):
    text = open(doc.path).read()  # 이벤트 루프 막힘
# ✅
async def parse(self, doc):
    text = await asyncio.to_thread(self._read_sync, doc.path)
```

### 6. print, type ignore, 비밀 정보 노출

- `print()` 금지 → 구조화 로깅
- `# type: ignore` 도메인 코드 금지
- API 키·파일 내용·절대 경로가 로그·에러에 들어가지 않게

---

## ✅ 자주 하는 작업 — 권장 흐름

### 새 어댑터 추가

```
1. domain/ports/ 인터페이스 확인 (없으면 추가)
2. adapters/<area>/<n>.py 구현
3. tests/integration/adapters/<area>/test_<n>.py
4. PLATFORM.md §9 어댑터 체크리스트 통과
5. DI 위치(FastAPI dependency)에 등록
```

### 새 API 엔드포인트 추가

```
1. API 명세서 v4 §3 인덱스에 경로 추가
2. 해당 §X에 요청·응답 본문 정의
3. 새 에러 코드 필요 시 ERROR_CODES.md 등록
4. backend/app/api/<area>.py 구현
5. tests/integration/api/test_<area>.py
6. 프런트엔드 타입은 OpenAPI 자동 생성
```

### 새 에러 코드 추가

```
1. ERROR_CODES.md §1.3 절차에 따라 등록
   (HTTP 상태, recoverable, details 스키마, 권장 UI 처리)
2. 도메인 예외와 매핑 (§12)
3. Application 레이어 미들웨어가 매핑 적용
4. 단위 테스트로 트리거 시나리오 검증 (§14)
```

### 새 OS 의존 처리 추가

```
1. PLATFORM.md 해당 절에 정책 먼저 추가
2. infra/ 또는 adapters/에 OS 분기 구현
3. tests/fixtures/posix/ 또는 windows/에 fixture 추가
4. CI 매트릭스가 모두 통과하는지 확인
```

---

## 🎯 첫 작업 권장 — 프로젝트 스캐폴딩

코드가 아예 없는 상태에서의 첫 작업은 **스캐폴딩 + 모듈 경계 셋업**이다 (설계서 §12 간트 첫 박스). 권장 순서:

```
Step 1 (1일):
- pyproject.toml + uv.lock 구성, Python 3.11
- backend/{app,domain,adapters,infra,config,tests}/ 디렉토리 생성
- frontend/ Vite + React + TypeScript 초기화
- pre-commit (ruff, ruff format, mypy)

Step 2 (1일):
- import-linter 설정 → domain이 외부 import 못 하게 자동 검증
- GitHub Actions CI 매트릭스 (macos-14, windows-latest, ubuntu-22.04)
- 각 매트릭스에서 단위·통합 테스트 통과 확인

Step 3 (1일):
- 설계서 §5 핵심 도메인 모델 (Document, Chunk, ExperimentConfig 등) 추가
- pydantic 모델 + 단위 테스트 (cache_key·fingerprint 결정성)
- SQLite 마이그레이션 (alembic 또는 자체)
```

3일치 작업이지만 모듈 경계가 잘못 잡히면 이후 모든 작업에 영향을 주므로 **여기서 서두르지 않는다**.

---

## 📋 작업 시작 체크리스트

새 작업·PR을 시작하기 전 확인.

- [ ] 이 작업이 P0인가, P1인가, P2인가 (컨셉 v4)
- [ ] 어느 모듈을 건드리는가 (설계서 v3)
- [ ] OS별 분기가 필요한가 (PLATFORM.md)
- [ ] 새 API 엔드포인트가 있다면 명세서에 정의되어 있는가
- [ ] 새 에러 코드가 필요한가 (있으면 ERROR_CODES.md 먼저)
- [ ] 결정 보류 사항을 건드리지 않거나 사전 결정되었는가

---

## 💡 의심스러우면 묻는다

다음 상황에서는 코드를 작성하지 말고 사용자에게 질문한다.

- 컨셉 v4 §9·§10의 결정 사항이 P1·P2로 미뤄진 항목 (예: 워크스페이스 캐시 공유 정책)
- API 명세서 §17의 미해결 결정사항 (인증 시점, citation 정밀도 등)
- 본 문서·CONTRIBUTING.md·다른 명세 사이에 충돌이 있어 보일 때
- "이 정도는 임의로 정해도 되겠지" 싶은 디테일 (그게 보통 어긋나는 지점)

---

## 🔑 핵심 결정 사항 (요약)

작업 중 자주 참조될 결정.

| 항목 | 결정 | 출처 |
|---|---|---|
| 타깃 OS | macOS · Windows · Linux 동등 | PLATFORM.md §1 |
| GPU 가속 | CPU 자동 fallback | PLATFORM.md §3.3 |
| 외부 LLM | OpenRouter, Gemini, OpenAI, Anthropic 4개 (P1) | 컨셉 §3.3.5 |
| 외부 LLM 키 | 사전 등록 필수, 자동 호출 금지 | API §15.0.5 |
| LLM 없을 때 | 검색 전용 모드 P0 | 컨셉 §3.3.4 |
| 모델 라이선스 | MUST 표시, 수락 게이트 | API §15.3 |
| 임베더 차원 변경 | 사전 감지 → 동의 → 이전 실험 archived | API §12.2 |
| 동시 인덱싱 | 워크스페이스당 1개 | 설계서 §8.1 |

---

## 📞 사용자(인간)에게 보고할 때

작업 완료 후 다음 형식으로 보고하면 검토하기 좋다.

```
✅ 변경 요약
   - 무엇을 했는가 (1~3줄)

📂 변경 파일
   - backend/domain/...
   - tests/...

🧪 테스트
   - 추가한 테스트: ...
   - 통과 여부: ...

📋 체크리스트
   - [x] 의존성 방향 검증 통과
   - [x] ERROR_CODES.md 누락 없음
   - [x] PLATFORM.md §9 체크리스트 만족
   - [x] 3개 OS CI 통과

❓ 결정 필요한 부분 (있는 경우)
   - ...
```

---

## 마지막으로

본 저장소는 4번에 걸쳐 결정 사항을 정제했다. 명세는 충분히 구체적이지만, 그래도 모호한 부분이 남아 있을 수 있다. **명세를 어기는 것보다 명세를 보완하는 게 낫다.** 모호한 부분을 발견하면 바로잡는 PR을 환영한다 (CONTRIBUTING.md §8 문서 업데이트 룰 참조).

행운을 빈다. 🚀
