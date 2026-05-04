"""Run backend (uvicorn) + frontend (vite) concurrently.

Usage:
    uv run python dev.py            # 운영 모드
    uv run python dev.py --test     # OPENRAG_LAB_TEST_MODE=1 (Fake 어댑터)

Ctrl-C 한 번이면 두 프로세스를 정리한다. 자식들은 부모와 같은 process group에
두어, 터미널의 Ctrl-C가 트리 전체에 SIGINT으로 전달되도록 한다 (uvicorn/vite는
SIGINT를 자체적으로 처리해 graceful shutdown 한다).
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"

BACKEND_CMD = [
    "uv",
    "run",
    "uvicorn",
    "openrag_lab.app.main:create_app",
    "--factory",
    "--reload",
]
FRONTEND_CMD = ["pnpm", "dev"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--test",
        action="store_true",
        help="OPENRAG_LAB_TEST_MODE=1 으로 백엔드 실행 (Fake 어댑터)",
    )
    args = parser.parse_args()

    backend_env = os.environ.copy()
    if args.test:
        backend_env["OPENRAG_LAB_TEST_MODE"] = "1"

    on_windows = sys.platform == "win32"
    procs: list[subprocess.Popen[bytes]] = [
        subprocess.Popen(BACKEND_CMD, cwd=ROOT, env=backend_env),
        subprocess.Popen(FRONTEND_CMD, cwd=FRONTEND, shell=on_windows),
    ]

    exit_code = 0
    try:
        while True:
            for p in procs:
                rc = p.poll()
                if rc is not None:
                    name = "backend" if p is procs[0] else "frontend"
                    print(f"\n[dev.py] {name} exited with code {rc}; shutting down.")
                    exit_code = rc or 1
                    return exit_code
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[dev.py] Ctrl-C received, stopping…")
        return 0
    finally:
        if not on_windows:
            signal.signal(signal.SIGINT, signal.SIG_IGN)
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=8)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    sys.exit(main())
