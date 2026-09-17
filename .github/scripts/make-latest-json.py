#!/usr/bin/env python3
"""生成 Tauri updater 清单 latest.json。

配对基准是 Release 上「已上传的真实资产名」（gh api 查询），不是本地文件名——
upload-artifact 会对文件名做消毒（空格→点），按本地名拼 URL 会与 Release 资产
对不上，升级下载 404（v0.1.9 的真实事故）。

用法（CI 内，必须在 `gh release create` 上传安装包**之后**跑）：
  VERSION=0.1.10 REPO=owner/name TAG=desktop-v0.1.10 \
    python3 .github/scripts/make-latest-json.py
产物: dist/latest.json（随后 `gh release upload --clobber` 补传到 Release）
"""
import datetime
import json
import os
import pathlib
import subprocess
import sys
import urllib.parse

DIST = pathlib.Path("dist")
VERSION = os.environ.get("VERSION", "").strip()
REPO = os.environ.get("REPO", "").strip()
TAG = os.environ.get("TAG", "").strip()

if not VERSION or not REPO or not TAG:
    sys.exit("缺少环境变量 VERSION / REPO / TAG")

BASE = f"https://github.com/{REPO}/releases/download/{TAG}"


def gh_api(path: str) -> dict:
    result = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"gh api {path} 失败: {result.stderr.strip()}")
    return json.loads(result.stdout)


def release_asset_names() -> list[str]:
    """Release 上已上传的真实资产名列表。"""
    assets = gh_api(f"repos/{REPO}/releases/tags/{TAG}").get("assets", [])
    return [a["name"] for a in assets]


def updater_assets(names: list[str]) -> dict[str, str]:
    """从真实资产名里找「更新用」产物 → 平台键。"""
    out: dict[str, str] = {}
    for name in names:
        if name.endswith(".app.tar.gz"):
            out["darwin-aarch64"] = name
        elif name.endswith(".nsis.zip"):
            # v1 风格兜底；Tauri 2 的 NSIS 更新产物是安装器本体 + .exe.sig（见下，优先）
            out.setdefault("windows-x86_64", name)
        elif name.endswith("-setup.exe"):
            out["windows-x86_64"] = name
    return out


def main() -> None:
    names = release_asset_names()
    platforms: dict[str, dict[str, str]] = {}
    for key, name in updater_assets(names).items():
        sig_name = name + ".sig"
        if sig_name not in names:
            sys.exit(f"Release 缺少签名资产 {sig_name}（检查 TAURI_SIGNING_PRIVATE_KEY）")
        sig_local = DIST / sig_name
        if not sig_local.exists():
            sys.exit(f"本地工作区缺少签名文件 {sig_local}（download-artifact 名单不全？）")
        platforms[key] = {
            "signature": sig_local.read_text(encoding="utf-8").strip(),
            "url": f"{BASE}/{urllib.parse.quote(name)}",
        }

    missing = {"darwin-aarch64", "windows-x86_64"} - set(platforms)
    if missing:
        sys.exit(f"缺少平台产物: {sorted(missing)}（Release 资产: {names}）")

    manifest = {
        "version": VERSION,
        "notes": f"DSH Pocket 桌面端 {VERSION}",
        "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "platforms": platforms,
    }
    (DIST / "latest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
