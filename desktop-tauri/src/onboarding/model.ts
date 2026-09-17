/** 向导步骤模型：状态机由 OnboardingWizard 持有，步骤组件只负责展示与动作。 */

export type StepId = "welcome" | "node" | "bridge" | "harness" | "account" | "done";

export const STEP_ORDER: StepId[] = ["welcome", "node", "bridge", "harness", "account", "done"];

export const STEP_LABEL: Record<StepId, string> = {
  welcome: "欢迎",
  node: "Node 运行时",
  bridge: "Worker 核心",
  harness: "Harness",
  account: "登录",
  done: "完成",
};

export interface StepNav {
  goNext: () => void;
  goPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** 耗时格式化（秒 → 「x 分 y 秒」/「y 秒」） */
export function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}
