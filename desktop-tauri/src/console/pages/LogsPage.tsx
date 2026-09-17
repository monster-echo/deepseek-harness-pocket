import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Copy, Check, FileWarning } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from "../../components/ui";
import { readLog } from "../../lib/worker";
import { Page, PageHeader } from "./PageHeader";

/**
 * 日志页：dshc.log 的尾部。
 * 这一页的「设计」就是让日志本身成为主角——等宽、高行距、可复制、贴底自动跟随。
 */
export function LogsPage() {
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
    if (follow && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [text, follow]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  const lines = text ? text.split("\n").length : 0;

  return (
    <Page>
      <PageHeader
        title="日志"
        description="dshc supervisor 与 dsh 的运行输出，每 5 秒自动刷新。"
        actions={
          <>
            <Button
              variant={follow ? "soft" : "outline"}
              size="sm"
              onClick={() => setFollow((f) => !f)}
              aria-pressed={follow}
            >
              {follow ? "跟随中" : "已暂停"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!text}>
              {copied ? <Check className="text-hue-green" /> : <Copy />}
              复制
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新
            </Button>
          </>
        }
      />

      {error ? (
        <EmptyState
          icon={<FileWarning />}
          title="读不到日志"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">dshc.log</CardTitle>
            <span className="text-[11px] tabular text-muted-foreground">{lines} 行</span>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <pre
              ref={preRef}
              className="max-h-[min(60vh,520px)] overflow-auto border-t border-border bg-muted/40 px-4 py-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap"
            >
              {text || (loading ? "加载中…" : "（空）")}
            </pre>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
