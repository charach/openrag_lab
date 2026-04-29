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
