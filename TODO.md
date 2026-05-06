# 다음 작업 — 디자인 정렬 후속

> 2026-05-06 갱신. 디자인↔코드 매칭 1차 머지(`eb12616`) + Phase 5 follow-up(F/E/G/C) 완료 후 남은 항목.
> 모두 **백엔드 P1 의존** 또는 **데이터 계약 변경 필요**라 단일 PR로 끝나지 않음.

---

## ✅ 2026-05-06 처리 완료

- **F** DropZone 컴포넌트 추출 (`frontend/src/components/DropZone.tsx`, stack/row layout, 6 unit tests). Auto-Pilot/Library inline 버전 교체.
- **E** NewWorkspaceModal preset 카드 그리드 (`frontend/src/components/modals/NewWorkspaceModal.tsx`, 컴팩트 preset 행 리스트, 5 unit tests). Shell.tsx 인라인 모달 교체, `createWorkspace(name, preset_id)` 와이어업.
- **G** Playwright 셀렉터 갱신. 핵심 요소에 `data-testid` 부여(`wizard-preset-*`, `wizard-mode-*`, `wizard-workspace-name`, `wizard-start`, `wizard-go-chat`, `chat-composer`, `chat-ask`, `chat-experiment-row`, `experiments-empty`). spec 01/02 새 영문 카피 + testid 기반으로 재작성. **3/3 e2e 통과**.
- **C** Per-file 인덱싱 진행률 WS. `ProgressReporter.emit_file` 추가, `IndexingService`가 parsing → chunking → embedding → embedded(+skipped/failed) 매 단계 emit. WS payload type `"file_progress"` 신설. 프런트 `indexing.files: Record<id, FileProgress>` + Auto-Pilot Step 03에 `PerFileList` 행. 백엔드 2 + 프런트 store 3 테스트 추가.

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

## H. License 게이트 실제 와이어업

**현 상태**: `LicenseModal` 컴포넌트는 만들어놨지만 어디서도 호출 안 함.
**해야 할 것**: 모델 다운로드 어댑터(`SentenceTransformerEmbedder` 첫 로드, llama.cpp GGUF 다운로드) 시 license 메타데이터를 백엔드에서 노출하고, 첫 호출 시 `LicenseModal.open` → 수락하면 다운로드 시작.

**전제**: 모델 다운로드를 명시적 트리거(API)로 분리해야 함. 현재는 lazy load.

**예상 분량**: 1일+ (모델 라이프사이클 결정 포함)

---

## I. WS startup race — 빠른 인덱싱 누락 픽스

**현 상태** (2026-05-06 e2e 작업 중 발견): Auto-Pilot에서 `Start indexing` 클릭 → `/index` 응답 → WS subscribe 사이의 짧은 윈도우에 백엔드가 이미 인덱싱을 끝내면, 마지막 `progress(ratio=1.0)` 메시지가 구독자 없는 토픽으로 발행되어 사라짐. 결과적으로 `Go to Chat` 버튼이 영영 disabled 상태로 남음.

**현재 우회**: `e2e/01-auto-pilot.spec.ts` 가 task API 폴링으로 워크어라운드. 사용자 UX는 그대로 깨져 있음.

**필요한 것** (택1):
1. 백엔드 — 토픽별 last-known-state 캐시. 새 구독자가 들어오면 즉시 마지막 메시지 replay.
2. 프런트 — WS 외에 task API 폴링 fallback (낮은 빈도, 1~2초). WS 미수신 시 보강.
3. 백엔드 — `/index` 응답을 토픽 구독 ack 이후 실제 indexing 시작으로 늦춤 (구조 변경 큼).

**추천**: (1) — last message replay 가 가장 깔끔. WS hub에 `topic → last_message: dict | None` 맵 추가, `subscribe` 시 즉시 publish.

**예상 분량**: 0.5일

---

## 우선순위 제안 (다음)

1. **I** WS startup race 픽스 (0.5일) — 진짜 UX 버그, 깔끔한 해결책 보임
2. **D** 외부 LLM WS 토픽 (0.5일) — 채팅 외 evaluator 대비
3. **A** 또는 **B** 백엔드 한쪽 (1일~)
4. **H** License 게이트 (모델 라이프사이클 결정 후)
