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

/**
 * semver 比较：a < b 返回负数，a > b 返回正数，相等返回 0。
 * 支持 "1.2.3" 与带 prerelease 的 "1.2.3-beta.1"（prerelease < 正式版）；
 * 解析失败的段按 0 处理，绝不抛错——只用于 UI 提示，不承载安全逻辑。
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/i, "").split("-", 2);
    const nums = (core ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
    return {
      major: nums[0] ?? 0,
      minor: nums[1] ?? 0,
      patch: nums[2] ?? 0,
      pre: pre ?? null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (const k of ["major", "minor", "patch"] as const) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k];
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1; // 正式版 > 预发布
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}
