import { useCallback, useEffect, useState } from "react";
import { GuidePage } from "./guide/GuidePage";
import { ConsoleApp } from "./console/ConsoleApp";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import {
  bootstrapStatus, onOpenOnboarding, onWorkerStartError, takeOnboardingRequest, type WorkerStatus,
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
 * 菜单「引导页」：环境齐全时以可关闭的 dialog 模态盖在引导面上（可看状态/更新 dshc），
 * 环境缺失时仍走硬门槛向导。
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
  /** 菜单重开的可关闭模态向导（环境齐全时；缺环境走 phase="wizard" 硬门槛） */
  const [wizardDialog, setWizardDialog] = useState(false);
  const status: WorkerStatus | null = useWorkerStatus();

  const openWizard = useCallback((reason?: string | null) => {
    setWizardReason(reason ?? null);
    setPhase("wizard");
  }, []);

  useEffect(() => {
    let alive = true;
    void bootstrapStatus()
      .then(async (s) => {
        const complete = s.onboardingDone && s.node.installed && s.bridge.satisfies && s.dshInstalled;
        // 菜单「引导页」触发主窗口从 Web GUI 导航回来时整页重载，
        // open-onboarding 事件会随旧页面丢掉——加载后消费 Rust 侧标志兜底
        let requested = false;
        try {
          requested = await takeOnboardingRequest();
        } catch {
          /* 旧壳无此命令：忽略 */
        }
        if (!alive) return;
        setPhase(complete ? "guide" : "wizard");
        if (complete && requested) setWizardDialog(true);
        // 浏览器调试入口：?wizard=dialog 直接看菜单重开的模态形态
        if (complete && new URLSearchParams(window.location.search).get("wizard") === "dialog") {
          setWizardDialog(true);
        }
      })
      .catch(() => alive && setPhase("wizard"));
    return () => {
      alive = false;
    };
  }, []);

  // Worker 启动失败：只有工具链坏了（缺 node 之类）才值得拉回向导；
  // 其余原因（端口占用、账号未登录、dsh 首启慢…）引导面已有对应修复卡，弹向导反而打断。
  useEffect(() => {
    const unlisten = onWorkerStartError((msg) => {
      const toolchainBroken = Boolean(status?.toolchainMissing) && !status?.degraded;
      if (toolchainBroken) openWizard(msg);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openWizard, status]);

  // 菜单「文件 → 引导页」：环境齐全 → 可关闭模态（补装/更新/看状态）；缺环境 → 硬门槛向导
  useEffect(() => {
    const unlisten = onOpenOnboarding(() => {
      // 事件已送达：同时消费掉 Rust 侧标志，避免下次加载重复弹
      void takeOnboardingRequest().catch(() => {});
      void bootstrapStatus()
        .then((s) => {
          const complete = s.onboardingDone && s.node.installed && s.bridge.satisfies && s.dshInstalled;
          if (complete) setWizardDialog(true);
          else openWizard(null);
        })
        .catch(() => openWizard(null));
    });
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
  return (
    <>
      <GuidePage onOpenWizard={() => setWizardDialog(true)} />
      {wizardDialog ? (
        <OnboardingWizard
          variant="dialog"
          onFinished={() => setWizardDialog(false)}
          onClose={() => setWizardDialog(false)}
        />
      ) : null}
    </>
  );
}
