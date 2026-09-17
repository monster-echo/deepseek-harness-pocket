import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, RefreshCw, Loader2, AlertTriangle, Wifi } from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState,
} from "../../components/ui";
import { workerQr, type QrInfo } from "../../lib/worker";
import { Page, PageHeader } from "./PageHeader";

/**
 * 配对页：把本机分享给别的账号时用。
 * 同账号场景不需要这里（登录同一掌鲸账号即自动互联）。
 * 焦点是二维码本身——页面上唯一「大」的东西。
 */
export function PairingPage() {
  const [qr, setQr] = useState<QrInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setQr(await workerQr());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  return (
    <Page>
      <PageHeader
        title="配对"
        description="把这台电脑共享给其他账号时使用；同一账号登录手机 App 无需扫码。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新
          </Button>
        }
      />

      {error ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="暂时拿不到配对码"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      ) : loading && !qr ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在生成…
        </div>
      ) : qr ? (
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <Card className="p-5">
            <div className="rounded-md bg-white p-3">
              <QRCodeSVG value={qr.payload} size={168} level="M" marginSize={0} />
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>配对码</CardTitle>
              <CardDescription>相机扫不动时，可在手机「添加电脑」里手输</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-lg font-semibold tracking-[0.14em]">
                  {qr.code}
                </code>
                <Button variant="outline" size="icon" onClick={() => void copy(qr.code)} aria-label="复制配对码">
                  {copied ? <Check className="text-hue-green" /> : <Copy />}
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <span className="text-[13px] text-muted-foreground">这台电脑</span>
                <Badge tone="neutral">{qr.name}</Badge>
                {qr.host ? (
                  <Badge tone="info">
                    <Wifi className="size-3" />
                    <span className="tabular">
                      {qr.host}:{qr.port}
                    </span>
                  </Badge>
                ) : null}
              </div>

              {qr.fingerprint ? (
                <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  指纹 {qr.fingerprint}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
        怀疑配对码泄露时，可在后续版本里「换配对码」使旧的立即作废。
      </p>
    </Page>
  );
}
