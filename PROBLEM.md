# 최종 체크 — 발견된 문제점

> 2026-04-29 시점, Phase 0–4 구현 완료 상태에서 직접 실행해 본 결과.
> 모든 자동 테스트(pytest 333, vitest 3, Playwright 3)는 그린이지만 운영 관점에서 살펴본 항목들.

---

## 🚨 CRITICAL — 즉시 수정 필요

### P-001 · 문서 업로드 경로 traversal

**파일**: `backend/src/openrag_lab/app/api/documents.py:148`
**검증 시나리오**:

```bash
curl -X POST "http://127.0.0.1:8000/workspaces/$ws/documents" \
  -F 'files=@/tmp/_evil.txt;filename=../../../etc/passwd-stub.txt'
```

**결과**: HTTP 201, 파일이 `<OPENRAG_HOME>/etc/passwd-stub.txt`에 저장됨 (워크스페이스 documents/ 밖으로 탈출).

**원인**: 업로드 핸들러가 `paths.documents_dir / filename`로 바로 결합하고, `target.parent.mkdir(parents=True)`이 임의의 상위 디렉토리를 생성. PLATFORM.md §2.4 (path traversal guard) + §4.1 위반.

**복구**:
1. `_safe_filename()` — `Path(raw.replace("\\", "/")).name`으로 디렉토리 구성 요소 제거. 빈 이름·`.`·`..`은 `PATH_OUTSIDE_WORKSPACE`로 거부.
2. 정제 후에도 `is_inside(documents_dir.resolve(), target)`로 한 번 더 검증 (심볼릭 링크/대소문자 파일시스템 대비 belt-and-suspenders).

**회귀 TC** (`tests/integration/api/test_documents.py`):
- `test_upload_filename_with_path_traversal_is_sanitized` — `../../../etc/evil.txt` 업로드 후 OPENRAG_HOME에 `etc/` 디렉토리 미생성.
- `test_upload_pure_dotdot_filename_rejected` — 파일명 `..`은 422 `PATH_OUTSIDE_WORKSPACE`.
- `test_upload_windows_separator_filename_sanitized` — `..\\..\\evil.txt` 도 안전.

**상태**: ✅ 수정 완료. 동일 공격 재현 시 파일이 워크스페이스 documents/ 안에만 생성되는 것을 확인.

---

## ⚠ WARN — 비치명, 정리 가치 있음

### P-002 · vitest `act()` 경고

**파일**: `frontend/src/App.test.tsx`
**현상**: AutoPilotWizard의 `useEffect`에서 fetch가 resolve할 때 일어나는 state 업데이트가 act() 밖에서 발생. 테스트는 통과하지만 stderr 노이즈.

**원인**: 테스트가 Promise를 await하지 않고 종료. Stub fetch가 async라 useEffect의 setState가 테스트 후 발생.

**제안**: `await screen.findByRole(...)`로 fetch resolve 까지 기다리거나 테스트마다 `act` 사용. 향후 React 19로 올라가면 더 엄격해질 수 있음.

### P-003 · httpx `data=` deprecation

**파일**: `backend/tests/integration/api/test_config.py`
**현상**:
```
DeprecationWarning: Use 'content=<...>' to upload raw bytes/text content.
```
TestClient에 raw YAML을 `data=`로 넘기는 한 군데에서 발생.

**제안**: `content=`로 교체 (tests/integration/api/test_config.py 내 `_upload_yaml`).

### P-004 · 프런트 번들 크기 > 500KB

**파일**: `frontend/dist/assets/index-*.js` ≈ 556 KB (gzip 172 KB)
**원인**: Recharts 단일 chunk. 코드 split 가능.
**제안**: ExperimentMatrix의 Recharts import를 `lazy(() => import(...))`로 빼면 초기 페이지에서는 로드 안 됨.

---

## ℹ️ MINOR — 인지하고 넘어가도 됨

### P-005 · CPU 모델 문자열이 "arm" (Apple Silicon)

**파일**: `backend/src/openrag_lab/infra/hardware/probe.py:45`
**현상**: `/system/profile` → `cpu.model: "arm"`. 사용자에게 보여주기엔 정보 부족.
**원인**: `platform.processor()`가 macOS에서 항상 빈 문자열 또는 "arm"만 반환. `sysctl machdep.cpu.brand_string`을 추가로 호출해야 정확한 모델명 (예: "Apple M2 Pro").
**제안**: P1에서 `_probe_cpu()`에 macOS 한정 sysctl fallback 추가.

### P-006 · PyMuPDF SwigPy DeprecationWarning ×3

**현상**: `<frozen importlib._bootstrap>:241: DeprecationWarning: builtin type SwigPyPacked has no __module__ attribute` 등.
**원인**: 3rd-party (`pymupdf`)의 SWIG 바인딩이 Python 3.12+에서 deprecated 된 동작 사용.
**대응**: pymupdf 다음 메이저로 올라가면 사라질 가능성. 우리 코드에서는 손댈 수 없음. 무시 OK.

---

## 🧪 OBSERVATION — 설계상 유의사항 (문제 아님)

### O-001 · `TaskQueue.join()`이 TestClient 안에서 블록되지 않는 이유

`asyncio.run(state.task_queue.join(task_id))`는 새 이벤트 루프를 만들고, 큐의 task는 TestClient의 portal 루프에 묶여 있어 join이 즉시 None을 반환. 다음 TestClient 요청이 portal 루프를 한 번 돌릴 때 비로소 task가 진행. 그래서 통합 TC는 `_wait_for_task`로 `/tasks/{id}`를 polling하는 패턴을 쓴다 (e.g. `test_chat_eval.py:_wait_for_task`).

운영 환경에는 영향 없음 — 단일 uvicorn 프로세스 안에서는 모든 task가 같은 루프에 있으니 정상 동작.

### O-002 · 진짜 production 모드 인덱싱은 sentence-transformers 다운로드 필요

`OPENRAG_LAB_TEST_MODE`를 안 주면 임베더 팩토리가 `SentenceTransformerEmbedder`를 만들고, 처음 호출 시 HF Hub에서 모델을 받는다. CI 매트릭스에서 매번 다운받지 않으려면 model cache 캐싱이 필요. 현재는 E2E를 TEST_MODE로만 돌리므로 실제 sentence-transformers 동작은 unit TC만 (`tests/integration/adapters/embedders/`).

### O-003 · 프런트와 백엔드가 별도 프로세스

`pnpm dev`(5173) + `uvicorn`(8000) 두 개를 띄워야 한다. README에는 명시되어 있지만, 사용자가 실수로 backend만 띄우면 프런트는 빈 화면. P2에서 단일 바이너리로 합치는 작업이 예정되어 있음.

---

## 검증 결과 요약

| 항목 | 결과 |
|---|---|
| ruff check | ✅ |
| ruff format check | ✅ |
| mypy strict (95 files) | ✅ |
| import-linter (2 contracts) | ✅ kept |
| pytest backend/tests | ✅ 333 → 336 (P-001 회귀 3건 추가, 플레이크 없음) |
| frontend typecheck | ✅ |
| frontend format check | ✅ |
| vitest | ✅ 3 passed (act 경고만 stderr) |
| pnpm build | ✅ (size 경고만) |
| Playwright e2e | ✅ 3 passed (2회 반복, 플레이크 없음) |
| production boot smoke | ✅ /system/profile, /system/presets, POST /workspaces, GET /workspaces 모두 200/201 |
| TEST_MODE boot smoke | ✅ |

**결론**: 자동 테스트는 모두 그린. 운영 관점에서 보안 1건(P-001)을 즉시 수정해야 함. 나머지는 정리/개선 권장.

---

# Phase 5 — 디자인 핸드오프 정렬 후 점검 (2026-05-01)

> Phase 5 (5.1 ~ 5.11 + 5.4) 9개 작업 머지 후 직접 백엔드를 띄워서
> 신규 엔드포인트 / 화면을 한 번씩 두드려 본 결과.
> backend pytest 352 / vitest 10 / build green.

## 검증 방법

1. `OPENRAG_HOME=/tmp/openrag-smoke OPENRAG_LAB_TEST_MODE=1 uv run uvicorn ... --port 18000`
2. curl로 신규 엔드포인트 22개 시나리오 (워크스페이스 rename, 문서 rename + traversal + 충돌, 청킹 미리보기, indexing + cancel, chat 두 턴 + history list + delete, experiment detail, golden set CRUD + CSV export, config export/import).
3. `pnpm build` — 빌드 통과
4. `pnpm test` — vitest 10 passed
5. `pnpm e2e` — 이전 플레이라이트 3개 중 1개만 통과 (아래 P5-002 참고)

## 🚨 CRITICAL — 즉시 수정

없음. Phase 5 변경으로 새로 도입된 보안/데이터 사고는 발견되지 않음.

## ⚠ WARN — 비치명, 정리 가치 있음

### P5-001 · Library 검색 input에 Icon 중복 렌더 (수정 완료)

**파일**: `frontend/src/screens/Library.tsx`
**현상**: 검색창 좌측에 돋보기 아이콘이 두 개 그려짐. 하나는 wrapper 바깥에, 다른 하나는 `position: absolute` 스팬 안에. 시각적으로만 어그러짐, 기능 영향은 없음.
**원인**: 화면 작성 중 첫 아이콘을 그렸다가 absolute span으로 옮긴 뒤 첫 아이콘을 못 지움.
**상태**: ✅ 수정 완료 (`pointer-events: none` 추가하여 input 클릭을 가리지 않도록 함).

### P5-002 · Playwright 2건 깨진 상태 (Phase 5 이전부터 누적)

**파일**: `frontend/e2e/01-auto-pilot.spec.ts`, `frontend/e2e/02-ab-matrix.spec.ts`
**현상**:
- `01-auto-pilot.spec.ts:12` — `getByRole("heading", { name: "Auto-Pilot" })` 타임아웃. 현재 UI는 `Auto-Pilot`을 `<span class="t-label">` (eyebrow) 로 그리고 `<h1>`은 "Drag your folder, click once, chat in five minutes."이다. 라벨/버튼 한국어 카피("이름:", "시작", "채팅으로", "검색 전용 모드", "참조한 청크")도 모두 새 영문 카피로 바뀌어 있어 매칭이 0건.
- `02-ab-matrix.spec.ts:78` — `/experiments` 진입 시 "워크스페이스를 먼저 선택하세요." 텍스트를 기다리는데, 같은 Playwright 워커가 1번 시나리오에서 워크스페이스를 만들고 그대로 이어달리면서 자동 선택돼 빈 상태가 사라짐.

**검증**: Phase 5 머지 직전 커밋 `05ed2dc` (Chanel 디자인 시스템) 기준으로 `pnpm e2e` 돌려도 동일하게 2 fail / 1 pass. 즉, **Phase 5 변경 때문이 아니다** — 디자인 핸드오프 적용 시점부터 e2e가 새 카피와 어긋나 있었음.

**복구 방향**:
1. spec을 새 카피로 갱신 (ko → en 또는 새 라벨로 매칭).
2. 또는 spec에 `data-testid`를 부여해 카피와 무관한 셀렉터로 안정화.
3. 워커 격리: `OPENRAG_HOME`을 spec 마다 다른 디렉토리로 분리.

PROBLEM.md 상단 "검증 결과 요약"의 Playwright ✅ 표기는 현재 사실과 다르므로 갱신 필요.

### P5-003 · `/golden-sets/{id}/export` HEAD 요청 시 405

**파일**: `backend/src/openrag_lab/app/api/golden_sets.py:export_csv`
**현상**: `curl -I` (HEAD) → 405 Method Not Allowed, allow: GET. 브라우저의 다운로드는 GET만 사용하므로 사용자 시나리오에는 영향 없음. 다만 일부 monitor/curl healthcheck가 HEAD로 사전체크하면 알람을 흘릴 수 있음.
**제안**: 우선순위 낮음. 필요 시 `@router.api_route(..., methods=["GET", "HEAD"])` 로 노출하거나 그대로 두기.

### P5-004 · 프런트 번들 크기 증가 (556 KB → 620 KB)

**파일**: `frontend/dist/assets/index-*.js`
**현상**: Phase 5에서 Library, GoldenSets, ConfigPortModal, Drawer 등 약 1,800줄 추가 — gzip 172 KB → 187 KB.
**원인**: 코드 자체. Recharts는 이전과 동일하게 단일 chunk로 동봉.
**제안**: P-004와 동일. ExperimentMatrix의 Recharts를 `lazy()` 처리하면 초기 페이지 로드는 가벼워짐.

### P5-005 · DropZone 컴포넌트 중복 (TODO 5.2 후속)

**파일**: `frontend/src/screens/AutoPilotWizard.tsx`, `frontend/src/screens/Library.tsx`
**현상**: TODO에 "업로드 드롭존 (현재 Auto-Pilot에만 있음) 재사용 컴포넌트로 분리" 항목이 있었으나 이번 라운드는 분리 없이 Library 안에 사실상 같은 로직을 다시 구현. 두 곳에서 드래그 상태/스타일이 미묘하게 갈릴 수 있음.
**제안**: 다음 라운드에 `components/DropZone.tsx`로 추출.

## ℹ️ MINOR

### P5-006 · 워크스페이스 헤더 드롭다운에서 `New` 버튼이 항상 노출됨

**파일**: `frontend/src/components/Shell.tsx`
**현상**: 워크스페이스가 0개이면 드롭다운 자체가 안 열렸던 이전 동작과 달리, 이제 항상 열리고 `+ New workspace` 한 줄만 노출됨. 첫 사용자 경험 측면에서는 더 좋지만, "Workspace —" 라벨이 살짝 어색하게 비어 보임.
**제안**: 첫 진입 시 자동으로 New 모달을 띄우거나, 빈 상태 placeholder ("아직 워크스페이스가 없습니다") 추가.

### P5-007 · 채팅 히스토리 갱신은 turn_id push만 하고 created_at는 클라가 추정

**파일**: `frontend/src/screens/ChatView.tsx` (`ask` 함수)
**현상**: chat 응답에는 `turn_id`만 있고 `created_at`은 없어, 클라이언트가 `new Date().toISOString()`으로 임시값을 채워 화면에 표시함. 서버 시계와 미세 어긋날 수 있음. 같은 세션에서 새로고침하면 서버가 정확한 값을 돌려주므로 결국 보정됨.
**제안**: `POST /chat` 응답에 `created_at`을 추가해 클라가 추정하지 않도록.

## 🧪 OBSERVATION — 설계상 의도

### O5-001 · 마이그레이션 v1→v2 안전성 확인

`schema.sql`은 `CREATE TABLE IF NOT EXISTS chat_turn ...`로 갱신했고, 별도로 v2 마이그레이션도 같은 SQL을 가진다. 신규 DB는 v1 스크립트에서 테이블이 만들어지고 v2가 IF NOT EXISTS로 no-op. 기존 v1 DB는 v2 적용 시점에만 테이블이 생긴다. 둘 다 정상.

### O5-002 · TODO.md 5.6 (배치 매트릭스), 5.10 (외부 LLM 인디케이터) 미구현

이 두 항목은 TODO.md "의도적으로 제외" 섹션에 P1으로 등록되어 있어 Phase 5 범위에서 빼는 것이 lean-spec 원칙에 부합. 외부 LLM 어댑터가 들어오는 다음 phase에서 함께 처리.

### O5-003 · TODO.md 5.12 (OpenAPI → TS 자동 생성) 보류

기능이 아닌 도구이고, 손으로 유지 중인 `client.ts`가 9개 작업 모두에서 정상 동작했기 때문에 `openapi-typescript` 도입을 의도적으로 미룸. 새 엔드포인트가 다음 라운드에 5개 이상 더 늘어나면 그 시점에 도입 검토.

## Phase 5 검증 결과 요약

| 항목 | 결과 |
|---|---|
| backend pytest (`backend/tests/`) | ✅ 352 passed |
| frontend typecheck | ✅ |
| frontend vitest | ✅ 10 passed (act 경고만 stderr — P-002와 동일) |
| frontend pnpm build | ✅ (size 경고만 — P5-004) |
| **frontend Playwright e2e** | ⚠️ 1 / 3 passed (P5-002) — Phase 5 이전부터 깨져 있던 사항 |
| 백엔드 직접 호출 22 시나리오 | ✅ 22 passed (HEAD 405는 GET 정상 확인 후 false positive로 판단) |
| 운영 신규 보안 이슈 | 0 |

**결론**: Phase 5에서 새로 도입된 코드는 백엔드/프런트 양쪽 모두 정상 동작. 단, **Playwright e2e가 디자인 핸드오프 시점부터 깨져 있었던 것이 이번에 비로소 재확인됨** — 셀렉터를 새 카피에 맞춰 갱신하는 것이 다음 우선순위. P5-001은 이번 세션에 수정 완료.
