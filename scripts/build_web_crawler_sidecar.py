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
BUNDLED_PLAYWRIGHT_BROWSER_PREFIXES = ("chromium_headless_shell-", "ffmpeg-")


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


def resolve_playwright_local_browsers_path() -> Path:
    import playwright

    return Path(playwright.__file__).resolve().parent / "driver" / "package" / ".local-browsers"


def resolve_playwright_driver_path() -> Path:
    import playwright

    return Path(playwright.__file__).resolve().parent / "driver"


def assert_playwright_browser_bundle(local_browsers_path: Path) -> None:
    existing_names = {item.name for item in local_browsers_path.iterdir()} if local_browsers_path.exists() else set()
    if any(name.startswith("chromium-") for name in existing_names):
        raise RuntimeError("Full Chromium must not be bundled; install Chromium with --only-shell")
    missing = [
        prefix
        for prefix in BUNDLED_PLAYWRIGHT_BROWSER_PREFIXES
        if not any(name.startswith(prefix) for name in existing_names)
    ]
    if missing:
        missing_text = ", ".join(missing)
        raise RuntimeError(
            f"Missing Playwright browser bundle entries: {missing_text}. "
            "Run `pnpm run build:sidecar` after the browser download completes."
        )


def copy_playwright_driver_bundle(sidecar_dist_dir: Path) -> None:
    source = resolve_playwright_driver_path()
    assert_playwright_browser_bundle(source / "package" / ".local-browsers")

    target = sidecar_dist_dir / "_internal" / "playwright" / "driver"
    if target.exists():
        shutil.rmtree(long_path(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(long_path(source), long_path(target), symlinks=True)


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


def stash_playwright_browser_bundle(build_path: Path) -> tuple[Path, Path]:
    source = resolve_playwright_local_browsers_path()
    assert_playwright_browser_bundle(source)

    stash = build_path / "playwright-local-browsers-stash"
    if stash.exists():
        shutil.rmtree(long_path(stash))
    stash.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(long_path(source), long_path(stash))
    return source, stash


def restore_playwright_browser_bundle(stashed_bundle: tuple[Path, Path]) -> None:
    source, stash = stashed_bundle
    if not stash.exists():
        return
    if source.exists():
        shutil.rmtree(long_path(source))
    source.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(long_path(stash), long_path(source))


def recover_stranded_playwright_browser_bundle(build_path: Path) -> None:
    # An interrupted build can leave the only copy of the browsers in the stash;
    # move it back before the build dir (and the stash with it) gets wiped.
    stash = build_path / "playwright-local-browsers-stash"
    if not stash.exists():
        return
    restore_playwright_browser_bundle((resolve_playwright_local_browsers_path(), stash))


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
    recover_stranded_playwright_browser_bundle(build_path)
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
    stashed_browsers = stash_playwright_browser_bundle(build_path)
    try:
        subprocess.run(command, check=True, cwd=str(ROOT), env=env)
    finally:
        restore_playwright_browser_bundle(stashed_browsers)
    executable_path = sidecar_dist_dir / platform_name()
    if not executable_path.exists():
        print(f"Missing built sidecar executable: {executable_path}", file=sys.stderr)
        return 1
    copy_playwright_driver_bundle(sidecar_dist_dir)
    prune_non_runtime_files(sidecar_dist_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
