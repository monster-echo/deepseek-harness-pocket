import { Download, HardDriveDownload, LogIn, Rocket } from "lucide-react";

/**
 * 欢迎：告诉用户要做什么、几步、大约多久/多少流量——
 * 首次引导会从网络下载运行组件，说清楚比让进度条凭空出现更让人安心。
 */
export function WelcomeStep({ reason }: { reason?: string | null }) {
  const rows = [
    { icon: HardDriveDownload, title: "准备运行环境", desc: "复用本机已有的 Node.js，或下载轻量运行时（约 30MB）" },
    { icon: Download, title: "安装 Worker 核心", desc: "从 npm 安装 dshc 与 DeepSeek Harness（后者约需几分钟）" },
    { icon: LogIn, title: "扫码登录", desc: "手机 DSH Pocket 扫一下，像 Telegram 那样" },
    { icon: Rocket, title: "启动", desc: "完成后本窗口直接进入 Harness 控制台" },
  ];
  return (
    <div className="flex flex-col items-center text-center">
      <p className="max-w-[40ch] text-[13px] leading-relaxed text-muted-foreground">
        只需一次，之后开机即在线。全程约 5–15 分钟（取决于网络）。
      </p>
      <div className="mt-4 w-full space-y-2.5 text-left">
        {rows.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex items-start gap-3 rounded-md bg-muted/60 px-3 py-2.5">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-tight">{title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>
      {reason ? (
        <p className="mt-4 w-full rounded-md bg-warning-soft px-3 py-2 text-left text-xs leading-relaxed text-hue-orange">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
