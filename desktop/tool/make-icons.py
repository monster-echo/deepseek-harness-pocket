#!/usr/bin/env python3
"""生成 DSH Pocket Worker 全套图标（确定性，无随机）。

- macOS AppIcon.appiconset/app_icon_{16..1024}.png — 圆角方块 + 白色 >_
- windows/runner/resources/app_icon.ico — 多尺寸 ICO
- assets/tray_icon.png      — Windows 托盘（品牌色 >_ 透明底）
- assets/tray_icon_mac.png  — macOS 托盘 template（黑色 >_ 透明底）

用法: python3 tool/make-icons.py   （在 desktop/ 下执行）
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND_TOP = (91, 123, 255)      # #5B7BFF
BRAND_BOTTOM = (47, 75, 223)    # #2F4BDF
BRAND = (77, 107, 254)          # #4D6BFE
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)

SS = 4  # 超采样倍数


def linear_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    """对角线渐变（64x64 源放大，视觉等价且快）。"""
    small = Image.new('RGB', (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return small.resize((size, size), Image.LANCZOS)


def rounded_square(size: int) -> Image.Image:
    """1024 逻辑尺寸的品牌圆角方块（macOS 风格 ~22.4% 圆角）。"""
    big = size * SS
    radius = round(big * 0.224)
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=radius, fill=255)
    img = linear_gradient(big, BRAND_TOP, BRAND_BOTTOM).convert('RGBA')
    img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def draw_glyph(draw: ImageDraw.ImageDraw, s: float, color: tuple, bold: float = 1.0) -> None:
    """在 1024 逻辑坐标系画 >_（s = 目标画布边长/1024）；bold 加粗笔画（托盘小图用）。"""
    w = 88 * s * bold
    # chevron >：折线，圆头端点
    pts = [(295 * s, 320 * s), (515 * s, 512 * s), (295 * s, 704 * s)]
    draw.line(pts, fill=color, width=round(w), joint='curve')
    # 端点补圆头
    r = round(w / 2)
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)
    # 光标 _
    x0, y0, x1, y1 = 595 * s, 704 * s - w, 755 * s, 704 * s
    draw.rounded_rectangle((x0, y0, x1, y1), radius=round(w / 2), fill=color)


def app_icon(size: int) -> Image.Image:
    """圆角方块 + 白色 >_。"""
    img = rounded_square(1024).resize((size * SS, size * SS), Image.LANCZOS)
    draw_glyph(ImageDraw.Draw(img), size * SS / 1024, WHITE)
    return img.resize((size, size), Image.LANCZOS)


def glyph_icon(size: int, color: tuple) -> Image.Image:
    """透明底 + 纯 >_（托盘用，笔画加粗以在小尺寸可读）。"""
    big = 256 * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw_glyph(ImageDraw.Draw(img), big / 1024, color, bold=1.8)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    # macOS AppIcon
    iconset = ROOT / 'macos/Runner/Assets.xcassets/AppIcon.appiconset'
    for size in (16, 32, 64, 128, 256, 512, 1024):
        app_icon(size).save(iconset / f'app_icon_{size}.png')

    # Windows ICO（多尺寸）
    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    app_icon(256).save(ROOT / 'windows/runner/resources/app_icon.ico', sizes=ico_sizes)

    # 托盘
    glyph_icon(32, BRAND).save(ROOT / 'assets/tray_icon.png')
    glyph_icon(32, BLACK).save(ROOT / 'assets/tray_icon_mac.png')
    print('icons generated under', ROOT)


if __name__ == '__main__':
    main()
