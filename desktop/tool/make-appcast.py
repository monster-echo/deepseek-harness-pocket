#!/usr/bin/env python3
"""生成 Sparkle/WinSparkle appcast.xml。

用法:
  make-appcast.py macos   --version 0.1.0 --build 12 --url https://…/a.zip \
      --signature <eddsa签名> --length 12345 [--out appcast-macos.xml]
  make-appcast.py windows --version 0.1.0 --build 12 --url https://…/setup.exe \
      --signature <dsa签名> --length 45678 [--out appcast-windows.xml]
"""
import argparse
import datetime
import sys
from xml.sax.saxutils import escape

TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
    <channel>
        <title>DSH Pocket Worker</title>
        <description>DSH Pocket Worker 桌面端更新</description>
        <language>zh-CN</language>
        <item>
            <title>版本 {version}</title>
            <pubDate>{pubdate}</pubDate>
{extra}            <enclosure url="{url}" {sig_attr} length="{length}" type="{mime}" />
        </item>
    </channel>
</rss>
"""


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('platform', choices=['macos', 'windows'])
    p.add_argument('--version', required=True)
    p.add_argument('--build', required=True)
    p.add_argument('--url', required=True)
    p.add_argument('--signature', required=True)
    p.add_argument('--length', required=True)
    p.add_argument('--out')
    args = p.parse_args()

    pubdate = datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')
    if args.platform == 'macos':
        extra = f'            <sparkle:version>{args.build}</sparkle:version>\n            <sparkle:shortVersionString>{args.version}</sparkle:shortVersionString>\n'
        sig_attr = f'sparkle:edSignature="{args.signature}"'
        mime = 'application/zip'
    else:
        extra = f'            <sparkle:version>{args.version}+{args.build}</sparkle:version>\n'
        sig_attr = f'sparkle:dsaSignature="{args.signature}"'
        mime = 'application/octet-stream'

    xml = TEMPLATE.format(
        version=escape(args.version),
        pubdate=pubdate,
        extra=extra,
        url=escape(args.url),
        sig_attr=sig_attr,
        length=args.length,
        mime=mime,
    )
    out = args.out or f'appcast-{args.platform}.xml'
    with open(out, 'w') as f:
        f.write(xml)
    print(f'written {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
