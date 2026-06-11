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


def resolve_playwright_local_browsers_path() -> Path:
    import playwright

    return Path(playwright.__file__).resolve().parent / "driver" / "package" / ".local-browsers"


def assert_playwright_browser_bundle(local_browsers_path: Path) -> None:
    existing_names = {item.name for item in local_browsers_path.iterdir()} if local_browsers_path.exists() else set()
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


def copy_playwright_browser_bundle(sidecar_dist_dir: Path) -> None:
    source = resolve_playwright_local_browsers_path()
    assert_playwright_browser_bundle(source)

    target = (
        sidecar_dist_dir
        / "_internal"
        / "playwright"
        / "driver"
        / "package"
        / ".local-browsers"
    )
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.mkdir(parents=True)
    for item in source.iterdir():
        if not any(item.name.startswith(prefix) for prefix in BUNDLED_PLAYWRIGHT_BROWSER_PREFIXES):
            continue
        destination = target / item.name
        if item.is_dir():
            shutil.copytree(item, destination, symlinks=True)
        else:
            shutil.copy2(item, destination)


def stash_playwright_browser_bundle(build_path: Path) -> tuple[Path, Path]:
    source = resolve_playwright_local_browsers_path()
    assert_playwright_browser_bundle(source)

    stash = build_path / "playwright-local-browsers-stash"
    if stash.exists():
        shutil.rmtree(stash)
    stash.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(stash))
    return source, stash


def restore_playwright_browser_bundle(stashed_bundle: tuple[Path, Path]) -> None:
    source, stash = stashed_bundle
    if not stash.exists():
        return
    if source.exists():
        shutil.rmtree(source)
    source.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(stash), str(source))


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
    stashed_browsers = stash_playwright_browser_bundle(build_path)
    try:
        subprocess.run(command, check=True, cwd=str(ROOT), env=env)
    finally:
        restore_playwright_browser_bundle(stashed_browsers)
    executable_path = sidecar_dist_dir / platform_name()
    if not executable_path.exists():
        print(f"Missing built sidecar executable: {executable_path}", file=sys.stderr)
        return 1
    copy_playwright_browser_bundle(sidecar_dist_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
