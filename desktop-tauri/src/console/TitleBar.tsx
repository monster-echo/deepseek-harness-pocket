import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

/**
 * 控制台窗口自绘标题栏（窗口配置为 decorations:false）。
 * Chrome 风格：整条可拖拽（含双击最大化），右侧三键；hover 关闭键变红。
 * 按钮与内容都不带 drag-region 属性，保证点击不被拖拽吞掉。
 */
export function TitleBar({ title }: { title: string }) {
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
