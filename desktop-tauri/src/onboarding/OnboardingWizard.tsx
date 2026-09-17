import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
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
 * 首次引导向导——全屏模态，环境不齐/未登录不能进入程序（产品硬门槛）。
 *
 * 结构：顶部步骤条（已完成打勾/进行中高亮）→ 步骤内容 → 底部导航。
 * 原则：每一步要么明确通过、要么给出原因和重试按钮，绝不无限转圈；
 * 「下一步」在当前步骤通过前禁用。菜单栏与托盘不受影响（webview 之外）。
 */
export function OnboardingWizard({ reason, onFinished }: { reason?: string | null; onFinished: () => void }) {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [adoptedSystem, setAdoptedSystem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
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

  // Esc 不允许退出向导（模态硬门槛）
  useEffect(() => {
    const swallow = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", swallow, true);
    return () => window.removeEventListener("keydown", swallow, true);
  }, []);

  const nodeDone = Boolean(adoptedSystem || status?.node.installed);
  const bridgeDone = Boolean(status?.bridge.installed && status?.bridge.satisfies);
  const harnessDone = Boolean(status?.dshInstalled);
  const accountOk = preflight?.items.find((i) => i.id === "account")?.state === "pass";
  const portOk = preflight?.items.find((i) => i.id === "port")?.state !== "fail";

  const firstUnmet = useMemo<StepId>(() => {
    if (!nodeDone) return "node";
    if (!bridgeDone) return "bridge";
    if (!harnessDone) return "harness";
    if (!accountOk) return "account";
    if (!portOk) return "done";
    return "done";
  }, [nodeDone, bridgeDone, harnessDone, accountOk, portOk]);

  const [step, setStep] = useState<StepId | null>(null);
  // 初始步：首次引导 → welcome 讲清楚要做什么；环境缺失重开 → 直达首个未满足项
  useEffect(() => {
    if (step === null && status !== null) {
      setStep(status.onboardingDone ? firstUnmet : "welcome");
    }
  }, [status, step, firstUnmet]);

  // 步骤满足时自动推进已在更后面的情况（重入向导：已完成步骤直接打勾跳过）
  useEffect(() => {
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
    (step === "account" && Boolean(accountOk));

  const goNext = () => {
    if (stepIndex < STEP_ORDER.length - 1) setStep(STEP_ORDER[stepIndex + 1]!);
  };
  const goPrev = () => {
    if (stepIndex > 0) setStep(STEP_ORDER[stepIndex - 1]!);
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshPreflight()]);
  }, [refreshStatus, refreshPreflight]);
  void refreshAll;

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
        <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在检查本机环境…
        </p>
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
      case "account":
        return <AccountStep onDone={() => void refreshPreflight()} />;
      case "done":
        return (
          <DoneStep
            items={preflight?.items ?? []}
            loading={preflight === null}
            busy={busy}
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-background px-6 py-8">
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
    </div>
  );
}
