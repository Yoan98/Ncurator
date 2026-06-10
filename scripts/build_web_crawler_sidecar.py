import platform
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SIDECAR_SCRIPT = ROOT / "resources" / "web_crawler_sidecar" / "web_crawler_sidecar.py"
OUTPUT_DIR = ROOT / "resources" / "web_crawler_sidecar" / "bin"
SIDECAR_NAME = "web_crawler_sidecar"


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

    pyinstaller = shutil.which("pyinstaller")
    if not pyinstaller:
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
        pyinstaller,
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
    subprocess.run(command, check=True, cwd=str(ROOT))
    executable_path = sidecar_dist_dir / platform_name()
    if not executable_path.exists():
        print(f"Missing built sidecar executable: {executable_path}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
