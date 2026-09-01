import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
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


def long_path(path: Path) -> str:
    """Return an extended-length path string on Windows to bypass the MAX_PATH (260 char) limit."""
    text = str(path)
    if platform.system().lower().startswith("windows") and not text.startswith("\\\\?\\"):
        text = "\\\\?\\" + os.path.abspath(text)
    return text


def resolve_playwright_driver_path() -> Path:
    import playwright

    return Path(playwright.__file__).resolve().parent / "driver"


def copy_playwright_driver_bundle(sidecar_dist_dir: Path) -> None:
    source = resolve_playwright_driver_path()

    target = sidecar_dist_dir / "_internal" / "playwright" / "driver"
    if target.exists():
        shutil.rmtree(long_path(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        long_path(source),
        long_path(target),
        symlinks=True,
        ignore=shutil.ignore_patterns(".local-browsers"),
    )


def assert_no_playwright_browser_bundle(sidecar_dist_dir: Path) -> None:
    forbidden = []
    for candidate in sidecar_dist_dir.rglob("*"):
        if candidate.name == ".local-browsers" or candidate.name.startswith(
            "chromium_headless_shell-"
        ):
            forbidden.append(candidate)
    if forbidden:
        paths = ", ".join(str(item.relative_to(sidecar_dist_dir)) for item in forbidden[:5])
        raise RuntimeError(f"Playwright browser files must not be bundled: {paths}")


def prune_non_runtime_files(sidecar_dist_dir: Path) -> None:
    removable_extensions = {".map", ".ts", ".tsx", ".mts", ".cts", ".py", ".pyc", ".pyo"}
    removable_directories = {"__pycache__", "tests", "test", "docs", "doc", "examples", "example", "types"}
    patchright_dir = sidecar_dist_dir / "_internal" / "patchright"
    if patchright_dir.exists():
        shutil.rmtree(long_path(patchright_dir))

    for current, directories, files in os.walk(sidecar_dist_dir, topdown=True):
        current_path = Path(current)
        kept_directories = []
        for name in directories:
            candidate = current_path / name
            if name.lower() in removable_directories:
                shutil.rmtree(long_path(candidate))
            else:
                kept_directories.append(name)
        directories[:] = kept_directories
        for name in files:
            candidate = current_path / name
            if candidate.suffix.lower() in removable_extensions:
                candidate.unlink()


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
        shutil.rmtree(long_path(sidecar_dist_dir))
    if build_path.exists():
        shutil.rmtree(long_path(build_path))
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
        "--collect-submodules",
        "crawl4ai",
        "--collect-data",
        "crawl4ai",
        "--collect-submodules",
        "ddgs",
        "--collect-data",
        "ddgs",
        "--exclude-module",
        "patchright",
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
    copy_playwright_driver_bundle(sidecar_dist_dir)
    prune_non_runtime_files(sidecar_dist_dir)
    assert_no_playwright_browser_bundle(sidecar_dist_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
