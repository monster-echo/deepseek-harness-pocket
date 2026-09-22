import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

/** WKWebView UA 含 "Macintosh"；Windows NT 含 "Windows"。 */
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

/**
 * macOS 分支：窗口是原生 Overlay 标题栏（open_console builder 配置），
 * 红绿灯由系统绘制在左上，这里只画一条拖拽带（整条可拖拽 + 双击 Zoom）。
 * 左侧留红绿灯位（pl-20 ≈ 80px），不放任何自绘窗口按钮。
 */
function MacTitleBar({ title }: { title: string }) {
  return (
    <div
      className="flex h-10 shrink-0 select-none items-center border-b border-border bg-background pl-20"
      data-tauri-drag-region
    >
      <span className="text-[12px] font-medium text-muted-foreground" data-tauri-drag-region>
        {title}
      </span>
      <div className="h-full flex-1" data-tauri-drag-region />
    </div>
  );
}

/**
 * Windows 分支：窗口是 decorations:false，自绘 Chrome 风格标题栏。
 * 整条可拖拽（含双击最大化），右侧三键；hover 关闭键变红。
 * 按钮与内容都不带 drag-region 属性，保证点击不被拖拽吞掉。
 */
function WindowsTitleBar({ title }: { title: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    const sync = () =>
      void win
        .isMaximized()
        .then((m) => alive && setMaximized(m))
        .catch(() => {});
    sync();
    const unlisten = win.onResized(() => sync());
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const btn =
    "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <div
      className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-border bg-background pl-3"
      data-tauri-drag-region
    >
      <span className="text-[12px] font-medium text-muted-foreground" data-tauri-drag-region>
        {title}
      </span>
      <div className="h-full flex-1" data-tauri-drag-region />
      <div className="flex h-full">
        <button type="button" className={btn} aria-label="最小化" onClick={() => void getCurrentWindow().minimize()}>
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          className={btn}
          aria-label={maximized ? "还原" : "最大化"}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
        </button>
        <button
          type="button"
          className={`${btn} hover:bg-destructive hover:text-destructive-foreground`}
          aria-label="关闭"
          onClick={() => void getCurrentWindow().close()}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** 控制台窗口标题栏：按宿主平台分流（open_console 的窗口配置与之一一对应）。 */
export function TitleBar({ title }: { title: string }) {
  return isMac ? <MacTitleBar title={title} /> : <WindowsTitleBar title={title} />;
}
