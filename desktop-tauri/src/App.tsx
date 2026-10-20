import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { GuidePage } from "./guide/GuidePage";
import { ConsoleApp } from "./console/ConsoleApp";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { Button } from "./components/ui";
import { EnvImportBanner } from "./components/EnvImportPanel";
import {
  bootstrapStatus, enterWebSurface, leaveWebSurface, onNavState, onOpenOnboarding,
  onWebSurfaceFailed, onWorkerStartError, retryWebSurface, setWebSurfaceIntent, showConsole,
  takeOnboardingRequest, webSurfaceState, type WorkerStatus,
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
    return (
      <ConsoleApp
        initialPanel={params.get("panel") ?? "run"}
        initialFocus={params.get("focus")}
      />
    );
  }
  return <MainSurface />;
}

/**
 * 主窗口顶部拖拽条：主窗口是 Overlay 标题栏（macOS 红绿灯浮在内容上），
 * 没有 drag-region 就拖不动、双击不能 Zoom。z-[60] 压过向导/模态（z-50），
 * 不挡内容——dsh web 页的拖拽条由 Rust 侧 selfheal_auth_probe 注入。
 *
 * 高度 32px = macOS 原生标题栏带实测高度（frame - contentLayoutRect = 32pt；
 * 红绿灯 14×14、上内边距 9pt、视觉中心 y=16pt）。原来写 28px，比系统带矮 4pt，
 * 红绿灯几乎占满、观感"顶栏被压扁"——这是「macOS header 比正常小」的来源之一。
 */
function DragStrip() {
  return <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-[60] h-8" />;
}

/**
 * 进入 Web 界面失败后的恢复卡（设计文档不变量 I3：失败必带出口）。
 *
 * 为什么需要它：原先主窗口可能被留在一个加载失败的页面上——macOS 应用菜单里
 * 又没有"回到引导页"，用户只剩退出应用一条路。现在 Rust 的看门狗判定失败后会
 * 自动把窗口拉回本 SPA 并亮出这张卡，用户至少有三个出口。
 */
function RecoveryOverlay({
  reason, autoRetry, retrying, onRetry, onGuide,
}: {
  reason: string;
  autoRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
  onGuide: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-xl border border-border bg-background p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-hue-orange" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">暂时连不上本机控制台</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{reason}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {autoRetry
                ? "正在自动重试，也可以立即手动重连。Worker 仍在后台运行，手机端不受影响。"
                : "自动重试已用尽，请手动重连；若仍然失败，打开控制台看日志或导出诊断。"}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={onRetry} disabled={retrying}>
            {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {retrying ? "正在重连…" : "重新连接"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => void showConsole("run")}>
              <Settings2 />
              打开诊断
            </Button>
            <Button variant="ghost" className="flex-1" onClick={onGuide}>
              回到引导页
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MainSurface() {
  const [phase, setPhase] = useState<"checking" | "wizard" | "guide">("checking");
  const [wizardReason, setWizardReason] = useState<string | null>(null);
  /** 菜单重开的可关闭模态向导（环境齐全时；缺环境走 phase="wizard" 硬门槛） */
  const [wizardDialog, setWizardDialog] = useState(false);
  /** 进入 Web 界面失败（Rust 看门狗/页面自证判定）→ 渲染恢复卡 */
  const [navFailure, setNavFailure] = useState<{ reason: string; autoRetry: boolean } | null>(null);
  const [retrying, setRetrying] = useState(false);
  /** 已握手过的 webUrl：同一目标只握一次，避免每 3 秒轮询重复请求 */
  const handedOff = useRef("");
  const status: WorkerStatus | null = useWorkerStatus();
  const webUrl = status?.run?.webUrl ?? "";

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
        // 上次进 Web 界面失败过？Rust 侧回退时是一次整页导航，事件会在新页面
        // 订阅之前发出去（必丢），所以状态一律从这里取回（设计文档 §3.5）。
        //
        // 顺序很关键：必须在 setPhase 之前把 navFailure 落定。否则同一提交里
        // 相位已变 guide、navFailure 还是 null，握手 effect 先过守卫 → 立刻重新握手 →
        // 每次回退都被拉回去，形成"无限弹回"（独立复核 B-4）。
        try {
          const nav = await webSurfaceState();
          if (alive && nav.phase === "failed" && nav.reason) {
            setNavFailure({ reason: nav.reason, autoRetry: nav.autoRetry });
          }
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

  // 「进入 Web 界面失败」事件（Rust 看门狗/页面自证判定后回退时发；页面重载会丢，故有上面的兜底读取）
  useEffect(() => {
    const unlisten = onWebSurfaceFailed((reason) => {
      setNavFailure({ reason, autoRetry: true });
      setRetrying(false);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // 导航相位推送：让恢复卡随 Rust 状态实时更新（也把 nav-state 这条事件用起来）
  useEffect(() => {
    const unlisten = onNavState((s) => {
      if (s.phase === "failed" && s.reason) {
        setNavFailure({ reason: s.reason, autoRetry: s.autoRetry });
      } else if (s.phase === "live" || s.phase === "connecting") {
        setNavFailure(null);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // 前端握手：把"进不进 Web 界面"的决定权从前端交给 Rust（设计文档 §4.4）。
  // 三个前置条件缺一不可：引导面就绪、没有向导模态盖着、不在恢复卡里。
  // 这样即便 run.json 里残留着上一轮的 webUrl，向导也不会被后台导航打断。
  useEffect(() => {
    if (phase !== "guide" || wizardDialog || navFailure) return;
    if (!webUrl || handedOff.current === webUrl) return;
    handedOff.current = webUrl;
    void enterWebSurface().catch(() => {
      handedOff.current = "";
    });
  }, [phase, wizardDialog, navFailure, webUrl]);

  // 意图只在"向导必须占住窗口"时显式关闭；开闸一律由握手负责（enterWebSurface）。
  // 缺了它，闸门一次打开就再也关不上：用户在向导里补装环境时会被后台导航走
  // （独立复核 B-3；Rust 侧只有这个开关能挡住轮询器）。
  // 注意不要在 checking 阶段关闸：回退后的 SPA 会先经历 checking，那时关闸会把
  // "自动重试"掐掉（卡上写着重试中、实际没人重试）。
  useEffect(() => {
    if (phase === "checking") return;
    const mustNotNavigate = phase === "wizard" || wizardDialog;
    if (!mustNotNavigate) return;
    handedOff.current = "";
    void setWebSurfaceIntent(false).catch(() => {});
  }, [phase, wizardDialog]);

  const doRetryWebSurface = useCallback(() => {
    setRetrying(true);
    handedOff.current = ""; // 允许对同一地址再次握手
    void retryWebSurface()
      .then((nav) => {
        // 还停在 failed（探活没过）：把卡留在原地，别让用户以为已经在连了。
        // 否则（idle/connecting）闸门已开、窗口很快会被导航走，保持"正在重连…"即可。
        if (nav.phase === "failed") {
          setNavFailure({ reason: nav.reason ?? "本机控制台暂时没有响应", autoRetry: nav.autoRetry });
          setRetrying(false);
        }
      })
      .catch(() => setRetrying(false));
  }, []);

  const backToGuide = useCallback(() => {
    setNavFailure(null);
    setRetrying(false);
    handedOff.current = "";
    void leaveWebSurface().catch(() => {});
  }, []);

  if (phase === "checking") {
    return (
      <>
        <DragStrip />
        <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
          <span className="text-[13px]">正在启动…</span>
        </div>
      </>
    );
  }
  if (phase === "wizard") {
    return (
      <>
        <DragStrip />
        <OnboardingWizard
          reason={wizardReason}
          onFinished={() => setPhase("guide")}
        />
      </>
    );
  }
  return (
    <>
      <DragStrip />
      <div className="flex h-full flex-col">
        {/* 启动引导：终端里有可导入的环境变量时出现（导入完/点稍后即消失） */}
        <EnvImportBanner onOpenDetail={() => void showConsole("run", "env")} />
        <div className="min-h-0 flex-1">
          <GuidePage onOpenWizard={() => setWizardDialog(true)} />
        </div>
      </div>
      {wizardDialog ? (
        <OnboardingWizard
          variant="dialog"
          onFinished={() => setWizardDialog(false)}
          onClose={() => setWizardDialog(false)}
        />
      ) : null}
      {navFailure ? (
        <RecoveryOverlay
          reason={navFailure.reason}
          autoRetry={navFailure.autoRetry}
          retrying={retrying}
          onRetry={doRetryWebSurface}
          onGuide={backToGuide}
        />
      ) : null}
    </>
  );
}
