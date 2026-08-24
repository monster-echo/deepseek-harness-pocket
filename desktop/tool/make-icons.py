#!/usr/bin/env python3
"""生成 DSH Pocket Worker 全套图标（与 dsh pocket 品牌 logo 统一）。

品牌源（唯一真相源）：react-native/assets/brand/logo{,-dark}.svg
- macOS AppIcon.appiconset/app_icon_{16..1024}.png — 品牌红 #B03C3C 圆角方块 + 白色标记
- windows/runner/resources/app_icon.ico — 多尺寸 ICO（同款）
- assets/tray_icon.png      — Windows 托盘（品牌红标记，透明底）
- assets/tray_icon_mac.png  — macOS 托盘 template（黑色标记，透明底）

用法: python3 tool/make-icons.py   （在 desktop/ 下执行；依赖 pillow + cairosvg）
"""

import io
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT.parent / 'react-native/assets/brand'
BRAND_RED = (176, 60, 60, 255)   # #B03C3C
BLACK = (0, 0, 0, 255)
SS = 4  # 超采样倍数

LOGO_DARK_SVG = BRAND / 'logo-dark.svg'   # 白色标记
LOGO_SVG = BRAND / 'logo.svg'             # 品牌红标记


def render_mark(svg: Path, size: int, color: tuple | None = None) -> Image.Image:
    """高清渲染品牌标记，按 alpha 裁边（cairosvg 2x 抗锯齿）。"""
    png = cairosvg.svg2png(url=str(svg), output_width=size, output_height=size)
    img = Image.open(io.BytesIO(png)).convert('RGBA')
    if color is not None:
        alpha = img.getchannel('A')
        img = Image.new('RGBA', img.size, color)
        img.putalpha(alpha)
    return img.crop(img.getbbox())


def rounded_square(size: int, color: tuple) -> Image.Image:
    """macOS 风格圆角方块（~22.4% 圆角，超采样抗锯齿）。"""
    big = size * SS
    mask = Image.new('L', (big, big), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=round(big * 0.224), fill=255)
    img = Image.new('RGBA', (big, big), color)
    img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def app_icon(size: int) -> Image.Image:
    """品牌红圆角方块 + 居中白色标记（较长边约 62%，保持宽高比）。"""
    big = size * SS
    img = rounded_square(big, BRAND_RED)
    mark = render_mark(LOGO_DARK_SVG, big)
    scale = (big * 0.62) / max(mark.size)
    mark = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    pos = ((big - mark.width) // 2, (big - mark.height) // 2)
    img.alpha_composite(mark, pos)
    return img.resize((size, size), Image.LANCZOS)


def glyph_icon(size: int, color: tuple) -> Image.Image:
    """透明底 + 纯标记（托盘用，等比缩放进 size×size）。"""
    src = LOGO_SVG if color == BRAND_RED else LOGO_DARK_SVG
    big = 256 * SS
    mark = render_mark(src, big, color=color)
    scale = size / max(mark.size)
    mark = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return out


def main() -> None:
    # macOS AppIcon
    iconset = ROOT / 'macos/Runner/Assets.xcassets/AppIcon.appiconset'
    for size in (16, 32, 64, 128, 256, 512, 1024):
        app_icon(size).save(iconset / f'app_icon_{size}.png')

    # Windows ICO（多尺寸）
    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    app_icon(256).save(ROOT / 'windows/runner/resources/app_icon.ico', sizes=ico_sizes)

    # 托盘
    glyph_icon(32, BRAND_RED).save(ROOT / 'assets/tray_icon.png')
    glyph_icon(32, BLACK).save(ROOT / 'assets/tray_icon_mac.png')
    print('icons generated under', ROOT)


if __name__ == '__main__':
    main()
