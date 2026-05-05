# 다음 작업 — 디자인 정렬 후속

> 2026-05-05 기준. 디자인↔코드 매칭 1차 머지(`eb12616`) 후 남은 항목.
> 모두 **백엔드 P1 의존** 또는 **데이터 계약 변경 필요**라 단일 PR로 끝나지 않음.

---

## A. `/experiments/batch` — Define Matrix 모달 + 실제 Run batch

**현 상태**: `MatrixDefinitionCard`는 read-only stub. "Run batch — coming with /experiments/batch (P1)" 라벨만 표시.

**필요한 것**:
1. **백엔드** `POST /workspaces/{ws}/experiments/batch`
   - 입력: `{ embedders: string[], chunkings: ChunkingConfig[], retrievals: string[], evaluators: string[], golden_set_id }`
   - 출력: `{ batch_id, total_evals, websocket_topic }`
   - 단일 task 안에서 N개 실험을 직렬로 돌리거나, queue에 N개 enqueue (concurrency 1 유지)
2. **백엔드 WS 토픽** `experiments.batch.{batch_id}`
   - `{type: "started", total, combos}`
   - `{type: "progress", done, total, current_combo}`
   - `{type: "completed", results: [{experiment_id, scores}]}`
3. **프런트 Define Matrix 모달** (`components/modals/DefineMatrixModal.tsx`):
   - 디자인 `screens/experiments.jsx:717` 의 `MatrixDefineForm` 그대로 포팅
   - `ALL_OPTIONS`는 시스템 preset 카탈로그에서 derive
   - Evaluator 6종 토글 (faithfulness/answer_relevance/ctx_precision/ctx_recall/latency_p95/cost_per_query)
   - Total runs 미리보기 카드 (combos × pairs × evaluators)
4. **프런트 BatchSessionBar** (디자인 `experiments.jsx:342`):
   - 진행률 + ETA + Cancel/Dismiss
   - WS subscription on `experiments.batch.{id}`
   - 다른 화면으로 이동해도 살아있어야 — `stores/batchSession.ts` (단일 active job)

**예상 분량**: 백엔드 1일 + 프런트 1일

---

## B. 진정한 Pause / Resume — 인덱싱 Task

**현 상태**: Auto-Pilot의 Pause 버튼은 토스트만 띄우는 스텁. 실제 Pause 시 `cancel + 재시작` 패턴.

**필요한 것**:
1. **도메인** `CancellationToken` → `PausableToken` 으로 확장 또는 `PauseSignal` 별도
   - `IndexingService.run`이 stage 사이마다 `await pause_signal.wait_if_paused()` 호출
2. **백엔드** `POST /tasks/{id}/pause`, `POST /tasks/{id}/resume`
   - state.task_queue에 paused 상태 추가
3. **프런트** `api.pauseTask` / `api.resumeTask` + Auto-Pilot 토글을 실제 호출로 교체
4. **WS** progress 메시지에 `{paused: true}` 플래그 추가 → 진행률 바 색상 변경

**위험**: 체크포인트가 stage 단위라 mid-stage pause는 불가. "stage 끝나면 pause" UX 결정 필요.

**예상 분량**: 1일 (도메인 디자인 결정 포함)

---

## C. Per-file 인덱싱 진행률 — WS reporter 확장

**현 상태**: `WebSocketProgressReporter.emit(stage, ratio)` 뿐. 어떤 파일이 어디까지 갔는지 알 수 없음.

**필요한 것**:
1. `ProgressReporter` 인터페이스에 `emit_file(file_id, stage, ratio)` 추가
2. `IndexingService` 가 doc 단위 루프에서 호출
3. 프런트 Auto-Pilot Step 03에 per-file 행 (디자인 `auto-pilot.jsx:358` `FileRow`)
   - 각 행에 status (queued / parsing / chunking / embedding / embedded / failed) + chunks count + 진행률
4. 메시지 type `"file_progress"` 추가 — 기존 `"progress"` 와 별도로 핸들

**예상 분량**: 0.5일

---

## D. 외부 LLM 호출 시점 WS 토픽

**현 상태**: Chat에서 `detectExternal()` 으로 클라가 추측 → `externalCallStore.begin/end` 직접 토글. 실제 백엔드가 외부 호출 중인지는 모름.

**필요한 것**:
1. 백엔드 chat 응답 진행 중에도 WS topic `chat.{turn_id}` 발행:
   - `{type: "external_call_started", provider, model}`
   - `{type: "external_call_completed"}`
2. 프런트는 현재의 detect-by-id 휴리스틱 대신 WS 메시지로 dot 토글

**왜 필요한가**: 향후 evaluator도 외부 LLM 사용. 채팅 외에서도 같은 dot이 켜져야 함.

**예상 분량**: 0.5일

---

## E. NewWorkspaceModal — preset 카드 그리드

**현 상태**: 헤더 "+ New workspace" → name 1필드 모달 (`Shell.tsx:552`).
**디자인**: name + preset 카드 그리드 3개 (`modal-content.jsx:3` `NewWorkspaceModal`).

**필요한 것**:
- `components/modals/NewWorkspaceModal.tsx` 분리
- preset 카드 = Auto-Pilot의 `PresetCard` 재사용 (소형)
- `api.createWorkspace(name, preset_id)` 는 이미 `preset_id` 받음

**예상 분량**: 30분 (Auto-Pilot의 PresetCard만 export 하면 거의 끝)

---

## F. P5-005 후속 — DropZone 컴포넌트 추출

**현 상태**: Auto-Pilot, Library, UploadModal 세 곳에 거의 같은 dropzone 로직 중복.
**해야 할 것**: `components/DropZone.tsx` 단일 컴포넌트로 통일. UploadModal 안의 zone은 이미 추출됐으니, Auto-Pilot/Library 의 inline DropZone 만 교체.

**예상 분량**: 30분

---

## G. P5-002 — Playwright 셀렉터 갱신

**현 상태**: `frontend/e2e/01-auto-pilot.spec.ts`, `02-ab-matrix.spec.ts` 가 디자인 핸드오프 시점부터 깨져 있음 (PROBLEM.md P5-002).

**해야 할 것**:
- spec을 새 영문 카피 + Stage breakdown 등 신규 UI 에 맞춰 갱신
- 또는 `data-testid` 부여해서 셀렉터를 카피와 분리
- 워커 격리: `OPENRAG_HOME` 을 spec 마다 다른 디렉토리

**예상 분량**: 0.5일

---

## H. License 게이트 실제 와이어업

**현 상태**: `LicenseModal` 컴포넌트는 만들어놨지만 어디서도 호출 안 함.
**해야 할 것**: 모델 다운로드 어댑터(`SentenceTransformerEmbedder` 첫 로드, llama.cpp GGUF 다운로드) 시 license 메타데이터를 백엔드에서 노출하고, 첫 호출 시 `LicenseModal.open` → 수락하면 다운로드 시작.

**전제**: 모델 다운로드를 명시적 트리거(API)로 분리해야 함. 현재는 lazy load.

**예상 분량**: 1일+ (모델 라이프사이클 결정 포함)

---

## 우선순위 제안 (내일)

1. **F** DropZone 추출 (30분, 워밍업)
2. **E** NewWorkspaceModal preset 카드 (30분)
3. **G** Playwright 셀렉터 갱신 (0.5일) — 깨진 e2e 복구
4. **C** Per-file 진행률 WS (0.5일) — Auto-Pilot UX 큰 보강
5. (남는 시간) **A** 또는 **B** 중 백엔드 한쪽
