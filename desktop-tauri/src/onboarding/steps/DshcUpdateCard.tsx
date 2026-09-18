import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "../../components/ui";
import {
  bridgeCheckUpdate,
  bridgeUpdate,
  workerStart,
  workerStop,
  type BridgeUpdateInfo,
} from "../../lib/worker";

/**
 * dshc 更新卡片：显示本地版本，「检查更新」对比 npm latest，
 * 有新版给一键更新（bridge_update 强制重装 @latest），完成后可就地重启 Worker 生效。
 * 引导向导「完成」步在 dialog（菜单重开）形态下展示——这是 dshc 更新的入口。
 */
export function DshcUpdateCard() {
  const [info, setInfo] = useState<BridgeUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setInfo(await bridgeCheckUpdate());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  const runUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      await bridgeUpdate();
      setUpdated(info?.latest ?? "");
      // 更新完重新体检，让版本号立即反映新值
      setInfo(await bridgeCheckUpdate());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  };

  const restart = async () => {
    setRestarting(true);
    setError(null);
    try {
      await workerStop().catch(() => {});
      await workerStart();
      setUpdated(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  };

  // 挂载即静默查一次（npm view 很快；失败不打扰，按钮可手动重查）
  useEffect(() => {
    void check();
  }, [check]);

  const current = updated ?? info?.current;
  const showUpdate = Boolean(info?.updateAvailable && !updated);

  return (
    <div className="rounded-md border border-border px-3.5 py-3">
      <div className="flex items-center gap-3">
        <Download className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-tight">
            Worker 核心（dshc）{current ? `v${current}` : "未安装"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {updating
              ? "正在从 npm 更新，可能需要一两分钟…"
              : checking && !info
                ? "正在检查更新…"
                : updated
                  ? "已更新，重启 Worker 后生效"
                  : showUpdate
                    ? `有新版本 v${info?.latest}`
                    : info
                      ? "已是最新版本"
                      : "检查失败，可点击重试"}
          </p>
        </div>
        {updating || restarting ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : showUpdate ? (
          <Button size="sm" onClick={() => void runUpdate()}>
            更新到 v{info?.latest}
          </Button>
        ) : updated ? (
          <Button size="sm" variant="outline" onClick={() => void restart()} disabled={restarting}>
            <RotateCw />
            重启 Worker
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => void check()} disabled={checking}>
            <RefreshCw className={checking ? "animate-spin" : ""} />
            检查更新
          </Button>
        )}
      </div>
      {error ? (
        <p className="mt-2 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
