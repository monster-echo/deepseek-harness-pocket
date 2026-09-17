import { useCallback, useEffect, useState } from "react";
import { GuidePage } from "./guide/GuidePage";
import { ConsoleApp } from "./console/ConsoleApp";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import {
  bootstrapStatus, onWorkerStartError, type WorkerStatus,
} from "./lib/worker";
import { useWorkerStatus } from "./lib/useWorkerStatus";

/**
 * 双窗口共用同一份前端产物，按 URL 参数分流：
 *   index.html                     → 主窗口（向导/引导面；Worker 就绪后由 Rust 导航到 dsh Web GUI）
 *   index.html?window=console&panel=… → 控制台窗口（托盘进入）
 *
 * 主窗口三态：
 *   checking —— 启动时查一次引导状态
 *   wizard   —— 全屏模态引导（环境不齐/未登录不能进程序；硬门槛）
 *   guide    —— 引导完成后：状态 + 启动/待机页
 * 自动弹向导的触发：工具链缺失（轮询器标记）、Worker 启动失败（boot 线程上报原因）。
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("window") === "console") {
    return <ConsoleApp initialPanel={params.get("panel") ?? "status"} />;
  }
  return <MainSurface />;
}

function MainSurface() {
  const [phase, setPhase] = useState<"checking" | "wizard" | "guide">("checking");
  const [wizardReason, setWizardReason] = useState<string | null>(null);
  const status: WorkerStatus | null = useWorkerStatus();

  const openWizard = useCallback((reason?: string | null) => {
    setWizardReason(reason ?? null);
    setPhase("wizard");
  }, []);

  useEffect(() => {
    let alive = true;
    void bootstrapStatus()
      .then(async (s) => {
        if (!alive) return;
        if (s.onboardingDone && s.node.installed && s.bridge.satisfies && s.dshInstalled) {
          setPhase("guide");
        } else {
          setPhase("wizard");
        }
      })
      .catch(() => alive && setPhase("wizard"));
    return () => {
      alive = false;
    };
  }, []);

  // Worker 启动失败：不吞、不盲试，把原因亮在向导里让用户处理
  useEffect(() => {
    const unlisten = onWorkerStartError((msg) => openWizard(msg));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openWizard]);

  // 工具链缺失（如 node 被删除）：轮询器标记 → 弹向导补装
  useEffect(() => {
    if (phase === "guide" && status?.toolchainMissing && !status?.degraded) {
      openWizard(status?.error ?? "运行环境缺失，需要重新引导");
    }
  }, [phase, status, openWizard]);

  if (phase === "checking") {
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <span className="text-[13px]">正在启动…</span>
      </div>
    );
  }
  if (phase === "wizard") {
    return (
      <OnboardingWizard
        reason={wizardReason}
        onFinished={() => setPhase("guide")}
      />
    );
  }
  return <GuidePage onOpenWizard={() => openWizard(null)} />;
}
