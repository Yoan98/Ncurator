import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SIDECAR_SCRIPT = ROOT / "resources" / "web_crawler_sidecar" / "web_crawler_sidecar.py"
OUTPUT_DIR = ROOT / "resources" / "web_crawler_sidecar" / "bin"
SIDECAR_NAME = "web_crawler_sidecar"
PYINSTALLER_CONFIG_DIR = ROOT / ".pyinstaller" / "web_crawler_sidecar"


def platform_name() -> str:
    system = platform.system().lower()
    if system.startswith("darwin"):
        return "web_crawler_sidecar"
    if system.startswith("windows"):
        return "web_crawler_sidecar.exe"
    return "web_crawler_sidecar"


def main() -> int:
    if not SIDECAR_SCRIPT.exists():
        print(f"Missing sidecar script: {SIDECAR_SCRIPT}", file=sys.stderr)
        return 1

    pyinstaller_module = "PyInstaller"
    pyinstaller_check = subprocess.run(
        [sys.executable, "-m", pyinstaller_module, "--version"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if pyinstaller_check.returncode != 0:
        print("pyinstaller is required to build the web crawler sidecar", file=sys.stderr)
        return 1

    build_path = ROOT / ".codex-tmp" / "web_crawler_sidecar_build"
    sidecar_dist_dir = OUTPUT_DIR / SIDECAR_NAME
    if sidecar_dist_dir.exists():
        shutil.rmtree(sidecar_dist_dir)
    if build_path.exists():
        shutil.rmtree(build_path)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        pyinstaller_module,
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        SIDECAR_NAME,
        "--distpath",
        str(OUTPUT_DIR),
        "--workpath",
        str(build_path / "work"),
        "--specpath",
        str(build_path / "spec"),
        "--collect-all",
        "crawl4ai",
        str(SIDECAR_SCRIPT),
    ]
    env = {
        **dict(os.environ),
        "PYINSTALLER_CONFIG_DIR": str(PYINSTALLER_CONFIG_DIR),
    }
    subprocess.run(command, check=True, cwd=str(ROOT), env=env)
    executable_path = sidecar_dist_dir / platform_name()
    if not executable_path.exists():
        print(f"Missing built sidecar executable: {executable_path}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
