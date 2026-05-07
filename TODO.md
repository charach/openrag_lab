# 다음 작업 — 디자인 정렬 후속

> 2026-05-07 갱신. 디자인↔코드 매칭 1차 머지(`eb12616`) + Phase 5 follow-up(F/E/G/C) + I/D/A/B 완료 후 남은 항목.
> 남은 항목은 모두 **모델 라이프사이클/외부 의존**이 큰 일 위주.

---

## ✅ 2026-05-07 처리 완료

- **I** WS startup race 픽스. `WebSocketHub`에 `topic → last_message` 캐시 추가, `subscribe` 시 새로 추가된 토픽에 한해 즉시 마지막 메시지 replay. 프런트 indexing store는 마지막 메시지가 `progress(ratio=1.0)`이 아닌 `type:"completed"` 인 경우도 phase=done 으로 인식. 백엔드 7 + 프런트 1 신규 테스트, e2e 01에서 task-API 폴링 워크어라운드 제거(60s → 0.7s 단축).
- **D** 외부 LLM 호출 시점 WS 토픽. 글로벌 토픽 `external_calls` 신설(`PublishingLLM` 래퍼가 `is_local=false` 인 LLM에 한해 `external_call_started`/`completed` emit, `try/finally`로 예외 시에도 completed 보장). `chat.py`가 외부 LLM 사용 시 자동 wrap. 프런트 `Shell`이 단일 구독 → `externalCallStore.begin/end` 직접 토글, `ChatView`의 `detectExternal()` 휴리스틱 기반 dot 토글 코드 제거. 백엔드 6 신규 테스트.
- **A** Define Matrix 모달 + 실제 Run batch. 백엔드 `POST /workspaces/{ws}/experiments/batch` 신설(embedders × chunkings × retrievals Cartesian product, 직렬 실행, `experiments.batch.{id}` 토픽으로 started/progress/completed 발행). 프런트 `DefineMatrixModal`(preset 카탈로그 derive, evaluator 6종 토글, total runs 미리보기) + `BatchSessionBar`(App level fixed bar, ETA 계산, cancel/dismiss, navigation 거쳐도 살아있음, `batchSession` store). 백엔드 7 + 프런트 6 신규 테스트.
- **B** 진정한 Pause/Resume. 도메인 `PauseSignal`(asyncio.Event 기반, `wait_if_paused()`로 stage boundary 블록) 추가, `IndexingService.run`이 per-document 경계마다 await. `TaskQueue`가 pause/resume 추가, cancel 시 자동 resume(블록된 waiter 깨어남). `POST /tasks/{id}/pause`·`/resume` 엔드포인트(idempotent — race 시 409 대신 200). 프런트 `api.pauseTask/resumeTask` + Auto-Pilot의 토스트 스텁을 실제 호출로 교체, WS `paused`/`resumed` 메시지로 indexing store의 `paused` 플래그 토글, 진행률 바 일시정지 시 회색. 백엔드 7(7개 PauseSignal unit + 2개 TaskQueue + 4개 /tasks endpoint) + 프런트 2 신규 테스트.
- **H** License 게이트 와이어업. 도메인 `ModelCard` + 인-프로세스 catalog(MiniLM/BGE-base/BGE-M3 + Apache-2.0/MIT 본문). `LicenseStore`가 `<root>/accepted_licenses.json`로 영속화. `GET /models`, `GET /models/{id}`, `POST /models/{id}/accept-license` 엔드포인트. `/system/presets`가 `embedder_license_id` 노출. Auto-Pilot 의 `launch()`가 인덱싱 직전 `api.getModel(embedder)` 호출 → 미수락 시 `LicenseModal` 열고, accept 시 `acceptLicense` 후 인덱싱 진행. e2e 01에 license modal 통과 단계 추가. 백엔드 11(LicenseStore unit 5 + /models endpoint 6) 신규 테스트.

## ✅ 2026-05-06 처리 완료

- **F** DropZone 컴포넌트 추출 (`frontend/src/components/DropZone.tsx`, stack/row layout, 6 unit tests). Auto-Pilot/Library inline 버전 교체.
- **E** NewWorkspaceModal preset 카드 그리드 (`frontend/src/components/modals/NewWorkspaceModal.tsx`, 컴팩트 preset 행 리스트, 5 unit tests). Shell.tsx 인라인 모달 교체, `createWorkspace(name, preset_id)` 와이어업.
- **G** Playwright 셀렉터 갱신. 핵심 요소에 `data-testid` 부여(`wizard-preset-*`, `wizard-mode-*`, `wizard-workspace-name`, `wizard-start`, `wizard-go-chat`, `chat-composer`, `chat-ask`, `chat-experiment-row`, `experiments-empty`). spec 01/02 새 영문 카피 + testid 기반으로 재작성. **3/3 e2e 통과**.
- **C** Per-file 인덱싱 진행률 WS. `ProgressReporter.emit_file` 추가, `IndexingService`가 parsing → chunking → embedding → embedded(+skipped/failed) 매 단계 emit. WS payload type `"file_progress"` 신설. 프런트 `indexing.files: Record<id, FileProgress>` + Auto-Pilot Step 03에 `PerFileList` 행. 백엔드 2 + 프런트 store 3 테스트 추가.

---

## 우선순위 제안 (다음)

TODO.md의 모든 P1 후속 항목(I/D/A/B/H)이 닫혔습니다. 다음으로 손댈 가치가 큰 후보:

- **모델 다운로드 명시적 트리거**: 현재 H는 "license 동의 후 lazy-load 진행" 까지. 진짜 명시적 다운로드 API(`POST /models/{id}/download` + 진행률 WS)로 분리하면 진행 표시·취소·디스크 사용 한도 등을 surface 할 수 있음.
- **Evaluator latency_p95 / cost_per_query**: 모달 토글에 노출돼 있지만 백엔드 메트릭 미구현. 평가 파이프라인에 wall-clock + 토큰 카운트 누적 + 결과 직렬화 추가.
- **CSV 내보내기 일원화**: 골든셋·실험·청킹 미리보기가 각자 export 코드 보유. 공용 CSV 빌더로 합치기.
