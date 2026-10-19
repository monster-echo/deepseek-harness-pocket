import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

/** WKWebView UA 含 "Macintosh"；Windows NT 含 "Windows"。 */
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

/**
 * macOS 分支：窗口是原生 Overlay 标题栏（open_console builder 配置），
 * 红绿灯由系统绘制在左上，这里只画拖拽带（整条可拖拽 + 双击 Zoom）。
 *
 * 高度按本机 AppKit 实测对齐（macOS 27，Swift/NSWindow 探针）：
 *   - 系统保留的标题栏带 = 32pt（frame − contentLayoutRect），红绿灯 14×14、
 *     上内边距 9pt、左内边距 9/32/55pt → 视觉中心 y = 16pt；
 *   - macOS 带统一工具栏的窗口 = 52pt（用户心里的"正常顶栏"）。
 * 因此整条 52px：上面 32px 与原生带**完全重合**（标题与红绿灯同轴心），
 * 余下 20px 作为应用工具行。原来写 40px 是两头不靠——比原生带高 8pt、
 * 又比 52pt 标准矮 12pt，红绿灯重心对不齐，看起来就"比正常小"。
 * 左侧 pl-20（80px）留红绿灯位（zoom 右边缘 69pt），不放任何自绘窗口按钮。
 */
function MacTitleBar({ title }: { title: string }) {
  return (
    <div
      className="flex h-[52px] shrink-0 select-none flex-col border-b border-border bg-background"
      data-tauri-drag-region
    >
      {/* 32px 行：与原生标题栏带等高，标题与红绿灯同轴 */}
      <div className="flex h-8 items-center pl-20" data-tauri-drag-region>
        <span className="text-[12px] font-medium text-muted-foreground" data-tauri-drag-region>
          {title}
        </span>
        <div className="h-full flex-1" data-tauri-drag-region />
      </div>
      {/* 20px 工具行：当前留白（保持原生 52pt 顶栏的呼吸感），
          后续「回到引导页 / Worker 状态胶囊」等动作放这里；整行可拖拽 */}
      <div className="flex-1" data-tauri-drag-region />
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
