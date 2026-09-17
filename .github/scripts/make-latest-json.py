#!/usr/bin/env python3
"""生成 Tauri updater 清单 latest.json。

Tauri 更新产物（createUpdaterArtifacts: true）会在 bundle 目录里同时产出
压缩包与同名 .sig。本脚本把它们配对，并按平台键写进清单。

用法（CI 内）：
  VERSION=0.1.9 REPO=owner/name TAG=desktop-tauri-v0.1.9 \
    python3 .github/scripts/make-latest-json.py
产物: dist/latest.json
"""
import json
import os
import pathlib
import sys
import urllib.parse

DIST = pathlib.Path("dist")
VERSION = os.environ.get("VERSION", "").strip()
REPO = os.environ.get("REPO", "").strip()
TAG = os.environ.get("TAG", "").strip()

if not VERSION or not REPO or not TAG:
    sys.exit("缺少环境变量 VERSION / REPO / TAG")

BASE = f"https://github.com/{REPO}/releases/download/{TAG}"


def updater_assets() -> dict[str, pathlib.Path]:
    """找出「更新用」压缩包（而非安装包本体）→ 平台键。"""
    out: dict[str, pathlib.Path] = {}
    for f in sorted(DIST.iterdir()):
        name = f.name
        if not f.is_file() or name.endswith(".sig"):
            continue
        if name.endswith(".app.tar.gz"):
            out["darwin-aarch64"] = f
        elif name.endswith(".nsis.zip"):
            out["windows-x86_64"] = f
    return out


def main() -> None:
    platforms: dict[str, dict[str, str]] = {}
    for key, path in updater_assets().items():
        sig_file = path.with_name(path.name + ".sig")
        if not sig_file.exists():
            sys.exit(f"{path.name} 缺少签名文件 {sig_file.name}（检查 TAURI_SIGNING_PRIVATE_KEY）")
        platforms[key] = {
            "signature": sig_file.read_text(encoding="utf-8").strip(),
            "url": f"{BASE}/{urllib.parse.quote(path.name)}",
        }

    missing = {"darwin-aarch64", "windows-x86_64"} - set(platforms)
    if missing:
        sys.exit(f"缺少平台产物: {sorted(missing)}（已找到 {sorted(platforms)}）")

    manifest = {
        "version": VERSION,
        "notes": f"DSH Pocket 桌面端 {VERSION}",
        "pub_date": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    }
    (DIST / "latest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
