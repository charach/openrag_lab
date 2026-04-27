# OpenRAG-Lab 플랫폼 호환 명세 (PLATFORM.md v1)

> **문서의 위치**: 컨셉(v2)·설계서(SDD v1)·API 명세서(v2)와 짝을 이루는 OS 호환 단일 진실 공급원(SSoT).
> **다루는 OS**: macOS, Windows, Linux **세 OS 동등 지원 (1급 시민)**.
> **존재 이유**: OS별 차이는 곳곳에 흩어지면 일관성을 잃고 Claude Code가 임의로 결정하게 된다. 본 문서가 모든 OS 의존 결정의 단일 출처다.
> **관계**: 본 문서가 다른 문서들과 충돌하면 **본 문서가 우선한다**.

---

## 1. 지원 정책

### 1.1. 지원 등급

세 OS 모두 **1급 시민(Tier 1)**으로 다룬다. 의미는 다음과 같다.

- 모든 P0 기능이 세 OS에서 동일하게 동작한다.
- CI는 세 OS 모두에서 통과해야 release 가능.
- 새 기능 추가 시 세 OS에서의 동작을 함께 검증한다.
- 세 OS 중 하나에서만 동작하는 기능은 P0에 포함하지 않는다.

### 1.2. 지원 버전

| OS | 최소 지원 버전 | 비고 |
|---|---|---|
| **macOS** | 12 Monterey 이상 | Apple Silicon · Intel 모두. Apple Silicon 권장. |
| **Windows** | Windows 10 21H2 이상, Windows 11 | x64만. ARM64는 P2. |
| **Linux** | Ubuntu 22.04 LTS, Fedora 38, Debian 12 이상 | x64. glibc 2.31+. |

### 1.3. 지원 아키텍처

| 아키텍처 | 지원 |
|---|---|
| x86_64 (Intel/AMD) | 1급 — 세 OS 모두 |
| arm64 (Apple Silicon) | 1급 — macOS만 |
| arm64 (Linux) | best-effort, P1 |
| arm64 (Windows) | 미지원, P2 |

---

## 2. 경로 표준

### 2.1. 사용자 데이터 디렉토리

각 OS의 **OS 표준 경로**를 따르되, 환경변수 `OPENRAG_HOME`으로 재정의 가능.

| OS | 표준 경로 | 환경변수 fallback 우선순위 |
|---|---|---|
| **macOS** | `~/Library/Application Support/OpenRAG-Lab/` | `$OPENRAG_HOME` → 표준 |
| **Windows** | `%APPDATA%\OpenRAG-Lab\` (예: `C:\Users\<user>\AppData\Roaming\OpenRAG-Lab\`) | `%OPENRAG_HOME%` → `%APPDATA%` → 표준 |
| **Linux** | `$XDG_DATA_HOME/openrag-lab/` (없으면 `~/.local/share/openrag-lab/`) | `$OPENRAG_HOME` → `$XDG_DATA_HOME` → 표준 |

> 설계서 §11.2의 `~/.openrag-lab/`은 **본 문서에 의해 위 표로 대체된다**.

### 2.2. 디렉토리 구조 (OS 공통)

표준 경로 아래의 구조는 OS와 무관하게 동일하다.

```
<OPENRAG_HOME>/
├── workspaces/             # 워크스페이스 데이터
├── models/                 # 다운로드한 모델 캐시
├── logs/                   # 로그 파일
├── settings.yaml           # 글로벌 설정
└── runtime.lock            # 단일 인스턴스 보장 (§5.4)
```

### 2.3. 임시 디렉토리

OS 표준 임시 경로를 사용한다.

| OS | 표준 |
|---|---|
| macOS / Linux | `$TMPDIR` (없으면 `/tmp`) |
| Windows | `%TEMP%` (없으면 `%LOCALAPPDATA%\Temp`) |

Python에서는 `tempfile.gettempdir()`로 OS별 자동 처리.

### 2.4. 경로 처리 규칙

코드에서 경로를 다룰 때 **반드시** 다음을 따른다.

1. **`pathlib.Path`만 사용**. 문자열 결합(`a + "/" + b`)·`os.path.join` 모두 금지.
2. **사용자 입력 경로는 `Path(...).resolve()`로 정규화**한 뒤 워크스페이스 내부인지 검증 (path traversal 방지).
3. **로그·메타에 경로 저장 시 POSIX 형식**(`/`)으로 통일. 표시 시에만 OS 네이티브로 변환.
4. **드라이브 문자**(Windows)는 `Path.drive`로만 접근.
5. **공백·유니코드·이모지 포함 경로**를 단위 테스트의 fixture에 반드시 포함 (한국어 사용자 대상).

### 2.5. 경로 길이 제한

| OS | 제한 | 처리 |
|---|---|---|
| macOS | 사실상 없음 (HFS+ 1023자, APFS 거의 없음) | 그대로 |
| Linux | PATH_MAX 4096 | 그대로 |
| Windows | **MAX_PATH 260자** (long path opt-in 시 32767) | 본 절 참조 |

**Windows 260자 제한 처리**:

1. 빌드 시 `app.manifest`에 `<longPathAware>true</longPathAware>` 포함.
2. 그래도 OS 정책이 비활성화된 경우를 위해, 경로가 240자를 넘으면 다음 중 하나로 fallback.
   - 워크스페이스 내부 경로면 `\\?\` prefix 사용 (Windows API 직접 호출).
   - 사용자 입력 경로면 즉시 `PATH_TOO_LONG` 에러로 중단.
3. 워크스페이스 ID는 12자, 문서 ID는 12자, 청크 ID는 16자로 고정해 내부 경로가 임계치를 넘지 않게 설계.

---

## 3. GPU 가속 백엔드

### 3.1. 가속 백엔드 매트릭스

| GPU | macOS | Windows | Linux |
|---|---|---|---|
| **NVIDIA (CUDA)** | 미지원 (Apple이 드라이버 중단) | ✅ 1급 | ✅ 1급 |
| **Apple Silicon (Metal/MPS)** | ✅ 1급 | n/a | n/a |
| **AMD (ROCm)** | n/a | ⚠️ 제한적 (DirectML로 fallback) | ✅ best-effort, P1 |
| **Intel (XPU/oneAPI)** | n/a | ⚠️ best-effort, P1 | ⚠️ best-effort, P1 |
| **GPU 없음 (CPU)** | ✅ | ✅ | ✅ |

### 3.2. 가속 백엔드 추상화

도메인 코드는 GPU 종류를 알아서는 안 된다. 추상 타입을 둔다.

```python
# domain/models/hardware.py
class AccelBackend(StrEnum):
    CPU = "cpu"
    CUDA = "cuda"
    METAL = "metal"     # Apple MPS
    ROCM = "rocm"       # AMD
    XPU = "xpu"         # Intel
    DIRECTML = "directml"  # Windows + AMD/Intel fallback
```

각 어댑터(Embedder, LLM)는 다음 인터페이스를 따른다.

```python
class AcceleratedAdapter(Protocol):
    @property
    def supported_backends(self) -> list[AccelBackend]: ...

    def select_backend(self, profile: SystemProfile) -> AccelBackend:
        """프로파일을 보고 가용한 최선의 백엔드를 반환."""
        ...
```

### 3.3. 백엔드 선택 우선순위

각 어댑터는 다음 순서로 시도하고, 사용 가능한 첫 항목을 채택한다.

```
[NVIDIA GPU 환경]   CUDA → CPU
[Apple Silicon]     METAL → CPU
[Apple Intel + GPU 미장착] CPU
[Windows + AMD]     DIRECTML → CPU      (ROCm은 P1)
[Linux + AMD]       ROCM (P1) → CPU
[Intel GPU]         XPU (P1) → CPU
[GPU 없음]          CPU
```

선택 결과는 `/system/profile` 응답의 `gpu.acceleration_backend`에 노출 (§API 갱신 참조).

### 3.4. 라이브러리별 백엔드 지원 현황

본 프로젝트가 의존하는 핵심 라이브러리의 OS·백엔드 매트릭스. **MVP에서 채택할 조합만** 정리.

| 라이브러리 | macOS Metal | Windows CUDA | Linux CUDA | CPU (모든 OS) |
|---|---|---|---|---|
| `sentence-transformers` (PyTorch) | ✅ MPS | ✅ | ✅ | ✅ |
| `llama-cpp-python` | ✅ Metal | ✅ CUDA | ✅ CUDA | ✅ |
| `chromadb` | ✅ | ✅ | ✅ | ✅ |
| `pymupdf` | ✅ | ✅ | ✅ | ✅ |

**제외 라이브러리** (MVP에서 사용 안 함):
- `bitsandbytes`: Windows·macOS 지원 불완전. 4-bit 양자화는 GGUF로 대체.
- `flash-attention`: Windows 빌드 까다로움. MVP에선 SDPA(PyTorch 기본) 사용.

### 3.5. 가속 검증 절차

기동 시 한 번 다음을 검사한다 (결과는 `/system/profile`의 `warnings`에 반영).

```
1. 추정된 백엔드로 작은 텐서 한 번 forward.
2. 실패 시 한 단계 낮은 백엔드로 fallback하고 warning 추가.
3. 모든 백엔드 실패 시 기능을 비활성화하지 말고 CPU로 실행하되,
   사용자에게 명시적으로 "GPU 가속을 사용하지 못함" 표시.
```

---

## 4. 파일 시스템 동작

### 4.1. 파일 잠금 (Windows 핵심 이슈)

Windows는 다른 프로세스가 파일을 열고 있으면 **삭제·이동·재명명 모두 실패**한다 (macOS·Linux는 대부분 가능).

**처리 규칙**:

1. **인덱싱 중인 원본 문서는 워크스페이스 안으로 복사하지 않는다.** 메타에 절대 경로만 저장하고 read-only로 연다.
2. **파일을 열 때 항상 read-share 모드.** Python에서는 기본 `open(path, "rb")`이 이를 만족하지만, 파서 라이브러리가 다른 모드를 쓰면 wrapping이 필요 (예: PyMuPDF는 file path 대신 bytes를 넘기는 방식 권장).
3. **삭제·이동 시 한 번 실패하면 100ms 후 재시도, 최대 3회**. 그래도 실패하면 `FILE_LOCKED` 에러로 사용자 안내.
4. **임시 파일**은 같은 볼륨에 만들어 `os.replace`로 원자적 교체 (cross-volume `rename`은 Windows에서 비원자적).

### 4.2. 대소문자 처리

| OS | 기본 동작 |
|---|---|
| macOS | 보존하지만 비교 시 무시 (case-insensitive, case-preserving) |
| Windows | 보존하지만 비교 시 무시 |
| Linux | 보존하고 구분 (case-sensitive) |

**규칙**:
- 시스템 내부 ID·파일명은 모두 lowercase. 사용자 입력 파일명은 그대로 보존.
- 같은 워크스페이스에 `Report.pdf`와 `report.pdf`가 들어오면 **하나의 문서로 취급하지 말고 별도 문서로 둠** (Linux에서 가능하므로). 단, content_hash가 같으면 §6.2의 DUPLICATE 처리는 그대로 작동.

### 4.3. 줄바꿈 문자

저장 시 **항상 `\n`으로 정규화**, 표시 시 OS 네이티브로 변환. SQLite에 저장하는 모든 텍스트는 `\n`만 포함.

`.gitattributes`에 `* text=auto eol=lf` 명시 (저장소 자체).

### 4.4. 파일 인코딩

저장은 항상 **UTF-8 (no BOM)**. 입력 파일을 읽을 때:

1. UTF-8로 시도.
2. 실패 시 UTF-16 (BOM 검사).
3. 실패 시 OS 기본 (Windows: cp949·cp1252 / macOS·Linux: locale).
4. 모두 실패 시 `replace` 모드로 강제 디코딩하고 warning.

### 4.5. 파일명 금지 문자

Windows의 금지 문자 (`< > : " / \ | ? *` + 예약어 `CON, PRN, AUX, NUL, COM1-9, LPT1-9`)를 **세 OS 공통 정책으로 적용**한다. 즉, Windows에서 만들 수 없는 파일은 macOS·Linux에서도 만들지 않는다 (포터빌리티 우선).

내보내기 파일명 생성 시 위 문자를 `_`로 치환.

---

## 5. 프로세스 및 실행

### 5.1. 실행 방식

| OS | 실행 방식 |
|---|---|
| **macOS** | (a) `openrag-lab serve` CLI, (b) `.app` 번들 (P1) |
| **Windows** | (a) `openrag-lab.exe serve` CLI, (b) 시작 메뉴 바로가기 (P1) |
| **Linux** | (a) `openrag-lab serve` CLI, (b) `.desktop` 파일 (P1) |

**MVP는 (a) CLI만**. (b) GUI 통합은 P1.

### 5.2. 백그라운드 서비스 등록

OS 부팅 시 자동 시작은 **MVP 범위에서 제외**. 사용자가 명시적으로 실행할 때만 동작.

P1에서 다음을 검토:
- macOS: `launchctl` LaunchAgent
- Windows: 시작 프로그램 또는 서비스
- Linux: `systemd --user` unit

### 5.3. 포트 바인딩

기본 `127.0.0.1:8000` (백엔드 + 정적 프런트). 충돌 시 `8001`, `8002` 순으로 자동 선택.

| 항목 | 정책 |
|---|---|
| 기본 포트 | 8000 |
| 자동 시도 범위 | 8000~8019 |
| RAG 서빙 (P1, §15.7) | 9001부터 자동 |
| 외부 바인딩 | `--bind 0.0.0.0` 명시 + 토큰 인증 (P1) |

**Windows 방화벽**: 첫 실행 시 사용자에게 inbound 허용 프롬프트가 뜬다. 매니페스트에 명시적 declaration을 포함하여 SmartScreen 경고 최소화 (P1 코드 사이닝).

### 5.4. 단일 인스턴스 보장

같은 머신에서 두 인스턴스가 동시에 실행되면 SQLite·ChromaDB 쓰기가 충돌한다.

**구현**: `<OPENRAG_HOME>/runtime.lock` 파일에 PID 기록 + OS별 advisory lock.

| OS | Lock 메커니즘 |
|---|---|
| macOS / Linux | `fcntl.flock(LOCK_EX \| LOCK_NB)` |
| Windows | `msvcrt.locking(LK_NBLCK)` 또는 `portalocker` 라이브러리 |

이미 실행 중인 인스턴스 감지 시: 기존 인스턴스의 URL을 사용자에게 안내하고 새 인스턴스는 종료.

### 5.5. 시그널 및 종료

| OS | 종료 시그널 |
|---|---|
| macOS / Linux | `SIGTERM` (graceful), `SIGINT` (Ctrl+C) |
| Windows | `CTRL_BREAK_EVENT`, `CTRL_C_EVENT` |

**모든 OS 공통**:
- 진행 중인 인덱싱·평가는 §8.1 취소 메커니즘으로 graceful 종료.
- 종료 타임아웃 30초. 초과 시 강제 종료 후 다음 실행 시 lock 파일 정리.
- 정상 종료가 아닌 경우(크래시) 다음 실행에서 `runtime.lock`의 PID가 살아있는지 확인 후 stale이면 정리.

### 5.6. 자식 프로세스 (있을 경우)

MVP는 단일 프로세스 (asyncio 기반). LLM·임베딩이 자체 서브프로세스를 만드는 경우(예: `llama.cpp` 서버 모드, P1 옵션) OS별 처리:

- macOS / Linux: 부모 종료 시 `setpgrp` + `killpg`로 자식 일괄 종료.
- Windows: Job Object 사용 (`win32job`).

---

## 6. 빌드 및 배포

### 6.1. Python 환경

| 항목 | 정책 |
|---|---|
| Python 버전 | 3.11.x (세 OS 동일 minor) |
| 패키지 매니저 | `uv` (세 OS 모두 지원) |
| Lock 파일 | `uv.lock` 단일 파일, 세 OS 공통 |
| Wheel 우선 | `--only-binary=:all:` 가능한 한 |

### 6.2. 네이티브 의존성

다음 라이브러리는 OS별 wheel이 필요하다. 모두 PyPI에서 자동 해결되는 것을 사용 (사용자가 직접 빌드하지 않게 함).

| 라이브러리 | macOS arm64 wheel | Windows x64 wheel | Linux x64 wheel |
|---|---|---|---|
| `pymupdf` | ✅ | ✅ | ✅ (manylinux2014) |
| `llama-cpp-python` | ✅ Metal | ✅ CUDA / ✅ CPU | ✅ CUDA / ✅ CPU |
| `chromadb` | ✅ | ✅ | ✅ |
| `numpy` | ✅ | ✅ | ✅ |

**대비**: wheel이 없는 환경(예: 매우 오래된 glibc, 32-bit OS)은 명시적으로 미지원 안내.

### 6.3. 프런트엔드 빌드

| 항목 | 정책 |
|---|---|
| Node | 20 LTS |
| 패키지 매니저 | `pnpm` |
| 빌드 출력 | `frontend/dist/` (정적 파일) |
| 백엔드와 결합 | FastAPI가 정적 파일로 서빙 (Bundle 모드) |

### 6.4. 배포 산출물

MVP에서는 다음 두 가지를 모두 제공한다.

1. **PyPI 패키지**: `pip install openrag-lab` 또는 `uv tool install openrag-lab` (세 OS 모두 동작).
2. **단일 바이너리**: P1에서 `pyinstaller` 또는 `nuitka`로 OS별 단일 실행 파일.

P1에서 추가 검토:
- macOS: `.dmg` (코드 사이닝, 노터라이제이션)
- Windows: `.msi` 또는 `.exe` (code signing)
- Linux: AppImage 또는 Flatpak

---

## 7. 시스템 통합 (P1+)

MVP에는 포함하지 않지만, 추후 구현 시 OS별 차이를 미리 정리.

### 7.1. 트레이/메뉴바 아이콘

| OS | 위치 | 라이브러리 후보 |
|---|---|---|
| macOS | 메뉴바 (NSStatusBar) | `rumps`, `pyobjc` |
| Windows | 시스템 트레이 | `pystray`, `pywin32` |
| Linux | 트레이 (StatusNotifierItem) | `pystray`, AppIndicator |

### 7.2. 알림

| OS | 메커니즘 |
|---|---|
| macOS | UserNotifications (pyobjc) |
| Windows | Toast (winrt) |
| Linux | libnotify (D-Bus) |

라이브러리: `desktop-notifier` (세 OS 통합 추상화).

### 7.3. 파일 연결 / "OpenRAG-Lab으로 열기"

P2 영역. 워크스페이스 패키지(.openrag) 더블클릭 시 자동 실행.

| OS | 구현 |
|---|---|
| macOS | `Info.plist`의 `CFBundleDocumentTypes` |
| Windows | 레지스트리 `HKCR\.openrag` |
| Linux | MIME type + `.desktop` |

---

## 8. 테스트 매트릭스

### 8.1. CI 매트릭스 (GitHub Actions 기준)

| OS | Python | GPU | 우선순위 |
|---|---|---|---|
| `macos-14` (arm64) | 3.11 | Metal (사용 가능 시) / CPU | 1급 |
| `windows-latest` | 3.11 | CPU | 1급 |
| `ubuntu-22.04` | 3.11 | CPU | 1급 |

**모든 PR**: 위 3개 매트릭스에서 단위·통합 테스트 통과 필수.

**Release 전**: 추가로 다음을 수동 또는 self-hosted runner로 검증.
- Windows 11 + NVIDIA CUDA
- Linux + NVIDIA CUDA
- macOS Apple Silicon + Metal

### 8.2. OS별 필수 회귀 테스트

각 OS에서 반드시 통과해야 하는 시나리오.

| 시나리오 | 검증 포인트 |
|---|---|
| 한글·이모지 포함 경로 | path 처리 |
| 공백 포함 경로 | shell 명령 escape |
| 매우 긴 경로 (240자+) | Windows long path |
| 다른 프로세스가 PDF를 열고 있을 때 인덱싱 | Windows 파일 잠금 |
| 종료 → 재실행 시 lock 파일 정리 | runtime.lock |
| `\r\n` 포함 텍스트 파일 인덱싱 | 줄바꿈 정규화 |
| 대소문자만 다른 두 파일 동시 업로드 | 대소문자 정책 |
| 환경변수 `OPENRAG_HOME`으로 경로 변경 | path resolution |
| GPU 가속 fallback (강제로 CUDA 비활성화) | §3.5 |

### 8.3. 픽스처 분리

`backend/tests/fixtures/` 하위에 OS별 분기가 필요한 것은 다음 패턴으로:

```
fixtures/
├── common/             # 모든 OS에서 동일
├── posix/              # macOS + Linux
└── windows/            # Windows 전용
```

테스트 코드는 `pytest.mark.skipif(sys.platform == "win32")` 등으로 명시적 분기.

---

## 9. 어댑터 작성 시 OS 체크리스트

새 어댑터(Parser, Embedder, VectorStore 등)를 작성할 때 본 절을 검토.

- [ ] **경로**는 `pathlib.Path`만 사용했는가
- [ ] **파일 열기**가 read-share 모드인가 (Windows)
- [ ] **임시 파일**이 같은 볼륨에 생성되고 `os.replace`로 교체되는가
- [ ] **줄바꿈**이 저장 시 `\n`으로 정규화되는가
- [ ] **인코딩**이 UTF-8로 명시되어 있는가
- [ ] **외부 라이브러리**가 세 OS 모두 wheel을 제공하는가
- [ ] **GPU 가속**이 §3.2 인터페이스를 따르고 fallback이 있는가
- [ ] **OS별 분기**가 도메인 코드로 새지 않고 어댑터·infra에 격리되어 있는가
- [ ] **테스트**가 세 OS의 fixture를 모두 커버하는가

---

## 10. 미해결 사항

본 문서를 작성하면서 추가로 도출된 결정 보류.

1. **macOS 코드 사이닝 / 노터라이제이션** — Apple 개발자 계정 필요. P1 시점 결정.
2. **Windows 코드 사이닝** — EV 인증서 비용. P1 시점 결정.
3. **Linux 배포 채널** — PyPI는 확정. AppImage·Flatpak·Snap 중 어떤 것을 1차로 할지는 P2.
4. **AMD/Intel GPU 지원 시점** — ROCm·XPU 어댑터 작성 시점. P1 후반부 또는 사용자 요청 기반.
5. **ARM64 Linux** — Raspberry Pi 등 수요 검증 후 P1 또는 보류.

---

## 11. 변경 관리

- 본 문서는 OS 의존 결정의 **단일 출처(SSoT)**다.
- 컨셉(v2), 설계서(SDD v1), API 명세서(v2)와 충돌 시 본 문서가 우선.
- 다른 문서를 갱신하기 전 본 문서를 먼저 갱신하고, 변경 내역을 다른 문서에 전파.
- 새 OS·아키텍처 지원 추가 시 §1.2, §1.3, §3.1, §6.2, §8.1을 순서대로 갱신.
