# Design ↔ Code Gap List — Resolved

> 기준: `docs/design/project/` (Claude Design 핸드오프) vs 현재 `frontend/src/`.
> 2026-05-05 기준 9/9 + 글로벌 시스템(0번) + 시각 프리미티브(8번) 작업 완료.
> 이 문서는 작업 결과물 인덱스로 남겨둡니다 — 각 항목은 단일 PR로 머지됨.

---

## 0. 글로벌 시스템 ✅

- ModalProvider / ToastProvider / `confirmModal()` 헬퍼 — `components/providers/`
- 외부 호출 인디케이터 (`stores/externalCall.ts`) → 헤더 dot pulse
- `Test mode · fake adapters` chip — `OPENRAG_LAB_TEST_MODE=1` 부팅 시
- 백엔드 `/system/profile` 응답에 `test_mode` 필드 추가

## 1. Auto-Pilot ✅

- DimMismatchModal — preset 변경 시 dim 불일치 감지 (백엔드 preset에 `embedder_dim` 추가)
- Pause/Resume — 토스트 스텁 (실제 pause는 P1)
- 실패 파일 패널 + Retry placeholder
- Stage breakdown 3카드 (Parsed / Chunked / Embedded)
- 인덱싱 cancel은 `confirmModal` 사용

## 2. Library ✅

- 5-stat 헤더 (Documents / Indexed / In progress / Queued / Total chunks)
- Format 토글 (All · PDF · MD · TXT) — 인접 chip group
- Document list ExportModal (csv/json/yaml + section toggles + live preview)
- Bulk select toolbar (Re-index / Delete / Clear) — gold 좌측 보더
- 빈 상태 UI ("No documents match your filter" + Clear filter)
- 백엔드 `DocumentItem`에 `chunk_count` 추가

## 3. Chunking Lab ✅

- Proportional ChunkStrip + 호버 highlight
- Floating ChunkInspector (char range / length / overlap / 80자 preview)
- Token DistributionBar (min/avg/max + target rule)
- Strategy 라디오 카드 (Fixed/Recursive + note + 한 줄 설명)
- Overlap stripe 토글 + 135° striped gradient on head/tail
- `useDeferredValue` + computing chip
- ExportModal 연동 (yaml/json + samples/stats sections)

## 4. Chat ✅

- 3-column 레이아웃 (실험 rail · transcript · context cards)
- Edit-and-resend (질문 textarea 인라인)
- Streaming reveal — 60 step 캐릭터 전개 + blink 커서
- External LLM 감지 + 헤더 chip + 답변 footer ExternalCallTag
- 요청 중 `externalCallStore` flip → 헤더 dot pulse
- Citation hover ↔ chunk 강조
- Clear thread / Export thread (yaml/json/md)
- ⌘⏎ 힌트 + 턴 카운트

## 5. Experiment Matrix ✅

- A/B 체크박스 칼럼 (FIFO 2개 선택)
- ABSummaryCard (wins/losses 0.02 threshold)
- Archived 행 dim + chip + A/B 비활성
- Per-pair sampling 표 (드로어 내, 5개 sample)
- MatrixDefinition 카드 (combos × runs read-only)
- BatchSessionBar — 백엔드 P1 의존, 미구현

## 6. Golden Set ✅

- GoldenPairModal로 Add/Edit 통일 (expected_chunk_ids 입력 포함)
- 백엔드 add/update API에 `expected_chunk_ids` 전달
- CSV Import → UploadModal 통일
- Delete → confirmModal
- 페어 목록에 chunk-id 메타 노출

## 7. 공통 모달 ✅

`components/modals/`:
- `ExportModal` (5 contexts 재사용: Library / Chunking / Chat / Experiment / Golden)
- `UploadModal` (Library / Auto-Pilot / Golden CSV)
- `DimMismatchModal`
- `LicenseModal`
- `GoldenPairModal`
- + `triggerDownload` / `mimeFor` 헬퍼

## 8. 시각 프리미티브 ✅

- `archive` 아이콘 추가
- `ExternalCallTag` 컴포넌트 추가
- `chip-gold` / `chip-mono` / `dot-success` / `dot-error` / `pulse-gold` 토큰 검증

## 9. Preset id 정렬 ✅

- 백엔드 `Preset.display_name` 추가 (`Speed` / `Balanced` / `Accuracy`)
- 내부 id (`lite` / `balanced` / `quality`)는 영속성 유지
- Rationale 한국어 카피로 정렬

---

## 의도적 미구현 (P1·P2)

- 외부 LLM 어댑터 자동 호출 시점 WS 토픽 — 현재 시점에서는 클라가 detect 후 로컬에서 토글
- `/experiments/batch` (Define Matrix → Run batch) — 백엔드 P1
- 진정한 Pause/Resume — 백엔드 task queue P1
- Per-file 인덱싱 진행률 (file_id별 stage) — WS reporter 확장 필요

---

## 검증 결과

- `pnpm typecheck` ✅
- `pnpm test --run` ✅ 9 files / 42 tests
- `pnpm build` ✅
- `uv run pytest backend/tests/` ✅ 414 passed
