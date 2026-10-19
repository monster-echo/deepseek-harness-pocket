import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button, Fold } from "../../../components/ui";
import { readLog } from "../../../lib/worker";

/**
 * 日志尾：原日志页的全部价值，收进故障恢复卡内的折叠区。
 * 自动跟随改为"仅在用户已贴底时跟随"——去掉了页面上的跟随/暂停开关（评分卡 §3.2 #8），
 * 但保留能力：手动往上翻不会被每 5 秒的刷新拽回底部。
 */
export function LogTail({ defaultOpen }: { defaultOpen: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      setText(await readLog(400));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const el = preRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  const lines = text ? text.split("\n").length : 0;

  return (
    <Fold title="dshc.log" hint={loading ? "加载中…" : `${lines} 行 · 每 5 秒自动刷新`} defaultOpen={defaultOpen}>
      {error ? (
        <p className="text-xs leading-relaxed text-hue-red">读不到日志：{error}</p>
      ) : (
        <>
          <div className="mb-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => void onCopy()} disabled={!text}>
              {copied ? <Check className="text-hue-green" /> : <Copy />}
              复制
            </Button>
          </div>
          <pre
            ref={preRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            className="max-h-[min(50vh,420px)] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap"
          >
            {text || (loading ? "加载中…" : "（空）")}
          </pre>
        </>
      )}
    </Fold>
  );
}
