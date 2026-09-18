import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "../components/ui";
import {
  bootstrapComplete, bootstrapStatus, preflightCheck, workerStart,
  type BootstrapStatus, type PreflightReport,
} from "../lib/worker";
import { AccountStep } from "../guide/AccountStep";
import { STEP_LABEL, STEP_ORDER, type StepId } from "./model";
import { useBootstrapProgress } from "./useBootstrapProgress";
import { BridgeStep } from "./steps/BridgeStep";
import { DoneStep } from "./steps/DoneStep";
import { HarnessStep } from "./steps/HarnessStep";
import { NodeStep } from "./steps/NodeStep";
import { WelcomeStep } from "./steps/WelcomeStep";

/**
 * 引导向导，两种形态：
 *   - gate（默认）：全屏硬门槛——首次引导/环境不齐不能进程序，Esc 无效；
 *   - dialog：可关闭模态——菜单「引导页」重开时盖在引导面上，Esc/关闭按钮可退，
 *     用于补装环境、查看状态与更新 dshc，不劫持整个窗口。
 *
 * 结构：顶部步骤条（已完成打勾/进行中高亮）→ 步骤内容 → 底部导航。
 * 原则：每一步要么明确通过、要么给出原因和重试按钮，绝不无限转圈；
 * 「下一步」在当前步骤通过前禁用。菜单栏与托盘不受影响（webview 之外）。
 */
export function OnboardingWizard({
  reason,
  variant = "gate",
  onClose,
  onFinished,
}: {
  reason?: string | null;
  variant?: "gate" | "dialog";
  onClose?: () => void;
  onFinished: () => void;
}) {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [adoptedSystem, setAdoptedSystem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const accountWarm = useRef(false);
  const { latest, log } = useBootstrapProgress();

  const refreshStatus = useCallback(async () => {
    try {
      const s = await bootstrapStatus();
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  const refreshPreflight = useCallback(async () => {
    try {
      setPreflight(await preflightCheck());
    } catch {
      /* 网络抖动：DoneStep 有重试 */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshPreflight();
  }, [refreshStatus, refreshPreflight]);

  // 环境检查超过 8 秒仍无结果：不再无限转圈，给出重试出口
  const [statusStale, setStatusStale] = useState(false);
  useEffect(() => {
    if (status !== null) {
      setStatusStale(false);
      return;
    }
    const t = setTimeout(() => setStatusStale(true), 8000);
    return () => clearTimeout(t);
  }, [status]);

  // Esc：硬门槛不允许退出向导；dialog 形态 Esc 即关闭
  useEffect(() => {
    const swallow = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (variant === "dialog") {
        e.preventDefault();
        onClose?.();
      } else {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", swallow, true);
    return () => window.removeEventListener("keydown", swallow, true);
  }, [variant, onClose]);

  const nodeDone = Boolean(adoptedSystem || status?.node.installed);
  const bridgeDone = Boolean(status?.bridge.installed && status?.bridge.satisfies);
  // 受管或全局 dsh 都算就绪（worker 启动时受管优先、全局兜底）
  const harnessDone = Boolean(status?.dshInstalled || status?.dshGlobal?.found);
  // 登录是可选步骤：「稍后登录」跳过即可继续，控制台「账号」页可补登
  const [accountSkipped, setAccountSkipped] = useState(false);
  const accountOk = preflight?.items.find((i) => i.id === "account")?.state === "pass";
  const accountDone = accountOk || accountSkipped;
  const portOk = preflight?.items.find((i) => i.id === "port")?.state !== "fail";

  const firstUnmet = useMemo<StepId>(() => {
    if (!nodeDone) return "node";
    if (!bridgeDone) return "bridge";
    if (!harnessDone) return "harness";
    if (!accountDone) return "account";
    if (!portOk) return "done";
    return "done";
  }, [nodeDone, bridgeDone, harnessDone, accountDone, portOk]);

  const [step, setStep] = useState<StepId | null>(null);
  // 初始步：首次引导 → welcome 讲清楚要做什么；环境缺失重开 → 直达首个未满足项
  useEffect(() => {
    if (step === null && status !== null) {
      setStep(status.onboardingDone ? firstUnmet : "welcome");
    }
  }, [status, step, firstUnmet]);

  // 步骤满足时自动推进已在更后面的情况（重入向导：已完成步骤直接打勾跳过）。
  // 「上一步」后停止自动推进——否则用户想回到前面的步骤重新选择，会被立刻弹回。
  const navigatedBack = useRef(false);
  useEffect(() => {
    if (navigatedBack.current) return;
    if (step !== null && step !== "welcome" && STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(firstUnmet)) {
      setStep(firstUnmet);
    }
  }, [step, firstUnmet]);

  const stepIndex = step ? STEP_ORDER.indexOf(step) : -1;
  const canGoNext =
    step === "welcome" ||
    (step === "node" && nodeDone) ||
    (step === "bridge" && bridgeDone) ||
    (step === "harness" && harnessDone) ||
    (step === "account" && accountDone);

  const goNext = () => {
    navigatedBack.current = false; // 重新向前走，恢复自动推进
    if (stepIndex < STEP_ORDER.length - 1) setStep(STEP_ORDER[stepIndex + 1]!);
  };
  const goPrev = () => {
    navigatedBack.current = true;
    if (stepIndex > 0) setStep(STEP_ORDER[stepIndex - 1]!);
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshPreflight()]);
  }, [refreshStatus, refreshPreflight]);

  const finish = async () => {
    setBusy(true);
    setStartError(null);
    try {
      await bootstrapComplete();
      await workerStart();
      onFinished(); // 切回主界面；Worker 就绪后由 Rust 导航到 Web GUI
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const stepBody = () => {
    if (status === null) {
      return (
        <div className="flex flex-col items-center gap-3 py-10 text-[13px] text-muted-foreground">
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            正在检查本机环境…
          </p>
          {statusStale ? (
            <>
              <p className="text-xs">检查长时间没有响应，后台服务可能还没就绪。</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatusStale(false);
                  void refreshAll();
                }}
              >
                <RotateCw />
                重试
              </Button>
            </>
          ) : null}
        </div>
      );
    }
    switch (step) {
      case "welcome":
        return <WelcomeStep reason={reason} />;
      case "node":
        return (
          <NodeStep
            status={status}
            adoptedSystem={adoptedSystem}
            onAdopted={() => {
              setAdoptedSystem(true);
              void refreshStatus();
            }}
            onDone={() => void refreshStatus()}
            progress={latest["node"]}
          />
        );
      case "bridge":
        return (
          <BridgeStep status={status} progress={latest["bridge"]} onDone={() => void refreshStatus()} />
        );
      case "harness":
        return (
          <HarnessStep status={status} progress={latest["dsh"]} onDone={() => void refreshStatus()} />
        );
      case "account": {
        // 二维码依赖本机服务标识（Worker 首启生成）：进本步先静默拉起，出码即成功
        if (!accountWarm.current) {
          accountWarm.current = true;
          void workerStart().catch(() => {});
        }
        return (
          <AccountStep
            onDone={() => void refreshPreflight()}
            onSkip={() => {
              setAccountSkipped(true);
              goNext();
            }}
          />
        );
      }
      case "done":
        return (
          <DoneStep
            items={preflight?.items ?? []}
            loading={preflight === null}
            busy={busy}
            showUpdate={variant === "dialog"}
            onStart={() => void finish()}
            onRefresh={() => void refreshPreflight()}
          />
        );
      default:
        return null;
    }
  };

  const showInstallLog =
    step === "node" || step === "bridge" || step === "harness";

  const body = (
    <div className="flex w-full max-w-[540px] flex-1 flex-col">
      {/* 品牌 + 步骤条 */}
      <div className="flex flex-col items-center text-center">
        <img src="/logo.png" alt="DSH Pocket" className="mb-3 size-12 rounded-xl" draggable={false} />
        <nav className="mb-6 flex w-full items-center justify-center gap-1.5" aria-label="引导步骤">
          {STEP_ORDER.map((id, i) => {
            const reached = stepIndex >= 0 && i <= stepIndex;
            const isCurrent = id === step;
            return (
              <div key={id} className="flex items-center gap-1.5">
                <div
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : reached
                        ? "bg-success-soft text-hue-green"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {reached && !isCurrent && i < stepIndex ? <Check className="size-3" /> : null}
                  {STEP_LABEL[id]}
                </div>
                {i < STEP_ORDER.length - 1 ? <span className="h-px w-3 bg-border" /> : null}
              </div>
            );
          })}
        </nav>
      </div>

      {/* 步骤内容 */}
      <div className="flex-1">{stepBody()}</div>

      {/* 详细日志（安装类步骤展示，专业安装器质感） */}
      {showInstallLog && log.length > 0 ? (
        <details className="mt-4 rounded-md border border-border">
          <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            详细日志（{log.length}）
          </summary>
          <pre className="max-h-40 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {log.join("\n")}
          </pre>
        </details>
      ) : null}

      {/* 底部导航 */}
      <div className="mt-6 flex items-center gap-2">
        {step !== null && stepIndex > 0 && step !== "done" ? (
          <Button variant="ghost" className="flex-1" onClick={goPrev} disabled={busy}>
            上一步
          </Button>
        ) : null}
        {step !== null && step !== "done" ? (
          <Button
            className="flex-[2]"
            disabled={!canGoNext || busy || status === null}
            onClick={goNext}
          >
            下一步
            {!canGoNext && status !== null ? <span className="text-xs opacity-70">（先完成本步）</span> : null}
          </Button>
        ) : null}
      </div>
      {startError ? (
        <p className="mt-2 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {startError}
        </p>
      ) : null}
    </div>
  );

  // dialog 形态：可关闭模态，盖在引导面上（菜单「引导页」重开用）
  if (variant === "dialog") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 px-6 py-8"
        onClick={() => onClose?.()}
      >
        <div
          className="relative flex max-h-full w-full max-w-[560px] flex-col overflow-y-auto rounded-xl border border-border bg-background px-6 py-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="关闭"
            className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onClose?.()}
          >
            <X className="size-4" />
          </button>
          {body}
        </div>
      </div>
    );
  }

  // gate 形态：全屏硬门槛
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-background px-6 py-8">
      {body}
    </div>
  );
}
