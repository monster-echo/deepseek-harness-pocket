import { useEffect, useRef, useState } from "react";
import { onBootstrapProgress, type BootstrapProgress } from "../lib/worker";

/**
 * 引导安装进度：订阅 Rust bootstrap-progress 事件。
 * 返回每个步骤的最新事件 + 有界日志（给「详细日志」面板，专业安装器质感）。
 */
export function useBootstrapProgress() {
  const [latest, setLatest] = useState<Record<string, BootstrapProgress>>({});
  const [log, setLog] = useState<string[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unlisten = onBootstrapProgress((p) => {
      if (!mounted.current) return;
      setLatest((prev) => ({ ...prev, [p.step]: p }));
      setLog((prev) => {
        const line = formatLine(p);
        const next = [...prev, line];
        return next.length > 80 ? next.slice(next.length - 80) : next;
      });
    });
    return () => {
      mounted.current = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const clearStep = (step: string) => {
    setLatest((prev) => {
      if (!(step in prev)) return prev;
      const next = { ...prev };
      delete next[step];
      return next;
    });
  };

  return { latest, log, clearStep };
};

function formatLine(p: BootstrapProgress): string {
  const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  if (p.phase === "download") {
    const pct = p.total && p.total > 0 ? `（${Math.round(((p.received ?? 0) / p.total) * 100)}%）` : "";
    return `[${now}] 下载中${pct}`;
  }
  if (p.line) return `[${now}] ${p.line}`;
  return `[${now}] ${p.step}/${p.phase}`;
}
