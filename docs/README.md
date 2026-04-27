# OpenRAG-Lab

> **로컬 지능형 RAG 워크벤치**: 사용자가 자신의 PC에서 개인 문서로 RAG 시스템을 만들고, 그 품질을 정량적으로 비교·튜닝할 수 있는 도구.

[![status](https://img.shields.io/badge/status-design--complete-blue)]()
[![mvp](https://img.shields.io/badge/MVP-2--4_weeks-orange)]()
[![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-green)]()

---

## 30초 요약

OpenRAG-Lab은 **로컬에서만 동작하는 RAG 실험 환경**이다. 클라우드 의존성 없이 다음을 할 수 있다.

- 📂 PDF·TXT·Markdown을 드래그-앤-드롭으로 인덱싱
- 🔍 임베딩 모델·청크 크기·검색 전략을 조합으로 비교
- 📊 4개 정량 지표(Faithfulness, Answer Relevance, Context Precision/Recall)로 A/B 평가
- 🤖 LLM 없이 검색 성능만 측정하는 모드 지원
- 🔌 외부 LLM(OpenRouter / Gemini / OpenAI / Anthropic) 옵션 활성화 가능
- 💾 모든 설정을 단일 YAML로 익스포트해 다른 PC에서 재현

세 OS(macOS·Windows·Linux) 모두 1급 시민으로 동등 지원.

---

## 핵심 가치

1. **프라이버시** — 문서·임베딩·질의가 외부로 나가지 않는다. 외부 호출은 사용자 명시적 옵트인 + UI 가시화.
2. **투명성** — 청킹 결과·검색 컨텍스트·평가 점수가 모두 시각화되어 블랙박스 없음.
3. **반복 실험성** — 매트릭스 평가로 N개 조합을 한 번에 돌리고 결과 비교.
4. **OS 동등성** — 어디서든 동일하게 동작.

---

## 페르소나 — 누구를 위한 도구인가

| 페르소나 | 시나리오 | 핵심 기능 |
|---|---|---|
| **지수** (변호사) | 판례 200건에 자연어 검색 | Auto-Pilot, 5분 안에 채팅 가능 |
| **민호** (학습자) | 청크 크기 변화에 따른 답변 차이 학습 | 청킹 실험실, 실시간 미리보기 |
| **수진** (엔지니어) | 사내 매뉴얼 1만 페이지에 최적 조합 도출 | 매트릭스 평가, YAML 익스포트 |

---

## 빠른 시작

> **현재 상태**: 본 저장소는 **설계 명세 단계**다. 코드는 아직 작성되지 않았다. 아래 명령은 구현 후 동작할 인터페이스의 약속.

```bash
# 설치 (구현 예정)
uv tool install openrag-lab

# 첫 실행 — 브라우저가 자동으로 열림
openrag-lab serve
```

처음 실행 시 다음 흐름:

1. 하드웨어 자동 진단 (CPU·RAM·GPU 백엔드)
2. 추천 프리셋 카드 3종 (속도/밸런스/정확도) 중 선택
3. 폴더 드래그-앤-드롭으로 문서 업로드
4. 인덱싱 자동 진행 (진행률 실시간 표시)
5. 채팅 화면에서 질의 — 답변에 출처(파일·페이지) 자동 표시

---

## 문서 인덱스

본 프로젝트는 **9개 문서**로 구성된다. 처음 진입하는 순서를 권장한다.

### 🟢 처음 읽을 것 — 프로젝트 이해

| 문서 | 역할 | 추천 독자 |
|---|---|---|
| **[README.md](./README.md)** | 30초 요약, 인덱스 | 모두 (지금 이 문서) |
| **[REQUIREMENTS_v4.md](./REQUIREMENTS_v4.md)** | 컨셉·기능 요구사항 (P0/P1/P2 우선순위) | PM, 디자이너, 모든 개발자 |

### 🔵 작업 시작 전 읽을 것 — 구조와 룰

| 문서 | 역할 | 추천 독자 |
|---|---|---|
| **[CLAUDE.md](./CLAUDE.md)** | Claude Code 자동 진입 문서 (필독 안내) | Claude Code, AI 에이전트 |
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | 작업 컨벤션·금지사항·PR 룰 | 모든 기여자 |
| **[ARCHITECTURE_v3.md](./ARCHITECTURE_v3.md)** | 아키텍처·모듈 구조·인터페이스 | 백엔드 개발자 |
| **[PLATFORM.md](./PLATFORM.md)** | OS별 차이의 단일 진실 공급원 (SSoT) | 모든 개발자 |

### 🟡 구현·계약 명세 — 작업 중 참조

| 문서 | 역할 | 추천 독자 |
|---|---|---|
| **[API_SPEC_v4.md](./API_SPEC_v4.md)** | REST + WebSocket 계약 (P0/P1/P2) | 백엔드·프런트엔드 |
| **[CONFIG_SCHEMA.md](./CONFIG_SCHEMA.md)** | 워크스페이스 YAML 설정 스키마 | 백엔드, 엔지니어 페르소나 |
| **[ERROR_CODES.md](./ERROR_CODES.md)** | 에러 코드 카탈로그 (46개) | 백엔드·프런트엔드, QA |

---

## 문서 간 우선순위

문서들이 충돌하면 다음 순서로 우선한다.

```
PLATFORM.md  >  CONFIG_SCHEMA.md  >  ERROR_CODES.md (해당 도메인 한정)
            >  컨셉 v4  >  설계서 v3  >  API 명세서 v4
            >  CONTRIBUTING.md (절차 한정)
```

OS 관련은 PLATFORM.md, 에러 코드는 ERROR_CODES.md, YAML 스키마는 CONFIG_SCHEMA.md가 최종 출처.

---

## MVP 범위 (2-4주)

| 영역 | MVP 포함 (P0) | 이후 (P1·P2) |
|---|---|---|
| 환경 진단 | 하드웨어 프로파일링, 프리셋 추천 | 의존성 자동 설치 |
| 입력 | PDF·TXT·Markdown | DOCX·HTML·JSON·EPUB |
| 청킹 | 고정 크기, 재귀적 분할 | 시맨틱, 문장 단위 |
| 검색 | Dense (벡터 검색), 검색 전용 모드 | BM25, Hybrid, 리랭커 |
| LLM | 로컬 LLM (선택), LLM 없이도 동작 | 외부 LLM 4종 |
| 평가 | 수동 골든 셋, 4개 지표, A/B 비교 | 자동 골든 셋, 매트릭스 평가 |
| 운영 | 채팅 UI, YAML 익스포트 | 로컬 RAG API, Dockerfile |

자세한 일정은 설계서 §12 간트 차트 참조.

---

## 기술 스택 (요약)

| 영역 | 추천 |
|---|---|
| 백엔드 | Python 3.11 + FastAPI |
| 비동기 작업 | asyncio + 자체 작업 큐 |
| 벡터 저장소 | ChromaDB (임베디드) |
| 임베딩 | sentence-transformers + Hugging Face |
| 로컬 LLM | llama.cpp (llama-cpp-python) |
| 메타데이터 | SQLite |
| 프런트엔드 | React + Vite + TypeScript |
| 패키징 | uv (Python) + pnpm (Node) |

> 모든 외부 라이브러리는 어댑터 인터페이스 뒤에 격리되어 있어 교체 가능하다. 도메인 코드는 라이브러리를 직접 알지 않는다. 상세는 설계서 §2.

---

## 결정 사항 (Decisions Log)

설계 단계에서 확정된 핵심 결정.

| 항목 | 결정 |
|---|---|
| **타깃 OS** | macOS · Windows · Linux 동등 지원 (PLATFORM.md §1) |
| **GPU 가속** | CPU 자동 fallback. CUDA / Metal / CPU 우선순위 (PLATFORM.md §3) |
| **외부 LLM** | OpenRouter, Gemini, OpenAI, Anthropic 4개 (P1). 키 등록 절차 필수 |
| **LLM 없을 때** | 검색 전용 모드 P0 1급 지원. 임베딩 성능 단독 평가 가능 |
| **모델 라이선스** | MUST 표시. 수락 필요 모델은 동의 게이트 |
| **임베딩 차원 변경** | 사전 감지 → 명시적 동의 → 이전 실험 archived 보존 |

---

## 다음 단계

설계가 끝났으니 다음은 구현. 권장 진행 순서:

1. **첫 작업**: 설계서 §12 간트의 첫 박스 — "프로젝트 스캐폴딩 + 모듈 경계 셋업"
   - 권장: `import-linter`로 의존성 방향 강제부터 잡기.
2. **수직 슬라이스**: 한 어댑터 군(parser → chunker → embedder)을 끝까지 완성한 후 다음으로.
3. **1주차 끝**: 빈약하더라도 인덱싱-검색이 한 번 돌아가게.

Claude Code에 작업을 시킬 때는 **CLAUDE.md → CONTRIBUTING.md** 순으로 컨텍스트 제공.

---

## 라이선스 / 기여

> **현재 상태**: 본 프로젝트의 라이선스는 아직 미정. 첫 코드 커밋 전에 결정 예정.

기여 가이드는 [CONTRIBUTING.md](./CONTRIBUTING.md) 참조.

---

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 설계 명세 v1 완성 (9개 문서) |
