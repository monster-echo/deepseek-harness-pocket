/**
 * 会话信息 Sheet（#21）：当前会话的完整统计。
 * 数据来自 reducer 从 dsh 事件流解析的 sessionView.stats；缺失字段显示「—」。
 */

import React from "react";
import { View } from "react-native";
import { Sheet } from "../../design-system/Sheet";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useDshStore } from "../../state/dshStore";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function dash(n: number, suffix = ""): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const v = n < 10 && Math.floor(n) !== n ? n.toFixed(1) : Math.round(n);
  return `${v}${suffix}`;
}

function ms(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  const s = n / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

export function SessionInfoSheet(
  props: Readonly<{ visible: boolean; onClose: () => void }>,
): React.JSX.Element {
  const stats = useDshStore((s) => s.sessionView.stats);
  const totalUsage = useDshStore((s) => s.sessionView.totalUsage);

  const avgTtft = stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : 0;
  const tokPerSec =
    stats.decodeMs > 0
      ? Math.round((stats.decodeTokens / stats.decodeMs) * 1000)
      : 0;
  const rows: ReadonlyArray<{ label: string; value: string }> = [
    { label: "轮数", value: dash(stats.turns) },
    { label: "步数", value: dash(stats.steps) },
    { label: "LLM 耗时", value: ms(stats.llmMs) },
    { label: "工具调用", value: ms(stats.toolMs) },
    { label: "首 token 平均", value: ms(avgTtft) },
    {
      label: "输出速率",
      value: tokPerSec > 0 ? `${compact(tokPerSec)} tok/s` : "—",
    },
    {
      label: "缓存命中",
      value: Number.isFinite(stats.cacheHitPct)
        ? `${Math.round(stats.cacheHitPct)}%`
        : "—",
    },
    { label: "回合输入", value: compact(stats.turnInput) + " tok" },
    { label: "回合输出", value: compact(stats.turnOutput) + " tok" },
    { label: "累计输入", value: compact(totalUsage.input) + " tok" },
    { label: "累计输出", value: compact(totalUsage.output) + " tok" },
  ];

  return (
    <Sheet
      visible={props.visible}
      title="会话信息"
      onClose={props.onClose}
      snapPoints={["50%", "80%"]}
    >
      <View className="bg-card border-border overflow-hidden rounded-xl border">
        {rows.map((row, index) => (
          <View
            key={row.label}
            className={cn(
              'flex-row items-center justify-between px-4 py-2.5',
              index < rows.length - 1 && 'border-border border-b',
            )}
          >
            <Text className="text-muted-foreground text-sm">{row.label}</Text>
            <Text className="text-foreground font-mono text-sm">
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
