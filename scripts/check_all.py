"""Every check, in one go: run before each push (the pre-push hook in .githooks does it for you).

Run:  .venv\\Scripts\\python.exe scripts/check_all.py

  1. Python: no undefined names, unused imports or syntax errors (ruff, from requirements-dev.txt).
  2. The reader extension: its scripts parse, and it still can't type, send, reply or react (check_reader.py).
  3. The site: every page's data opens without an error for the demo, a student, a preview student and the admin
     (smoke_test.py, on a throwaway database with no AI and no network).
  4. The frontend: it type-checks the way the deploy builds it (a type error here once failed every deploy unnoticed).
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
NPX = shutil.which("npx") or "npx"


def run(name: str, cmd: list[str], cwd: Path = ROOT) -> bool:
    print(f"-- {name}", flush=True)
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = (out.stdout + out.stderr).strip()
    if out.returncode:
        print(text or f"(exit {out.returncode})")
        return False
    if text:
        print("   " + text.splitlines()[-1])
    return True


def main() -> int:
    steps = [
        ("Python lint", [PY, "-m", "ruff", "check", "backend", "scripts", "--select", "F,E9"]),
        ("Reader scripts parse", [shutil.which("node") or "node", "--check", *map(str, sorted((ROOT / "reader-extension").glob("*.js")))]),
        ("Reader stays read-only", [PY, "scripts/check_reader.py"]),
        ("Site smoke test", [PY, "scripts/smoke_test.py"]),
    ]
    ok = all([run(name, cmd) for name, cmd in steps])  # every step runs, so one run shows every problem
    ok = run("Frontend type check", [NPX, "tsc", "-b"], cwd=ROOT / "frontend") and ok
    print("All checks passed." if ok else "Checks FAILED: fix the above before pushing.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
