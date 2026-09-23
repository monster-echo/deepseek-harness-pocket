/**
 * 轨迹页（批次 1，移动端形态）。
 *
 * 对应 Web 的 Trajectory 视图：事件账本 + 耗时总览。移动端不做缩放手势，
 * 改为「概览卡 + 可滚动步骤列表」，点按工具步骤展开明细。
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Clock,
  ListChecks,
  Package,
  User,
  Wrench,
} from 'lucide-react-native';
import { ScreenHeader } from '@/components/app/screen-header';
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { useDshStore } from '../state/dshStore';
import {
  summarizeTrajectory,
  type TrajectoryKind,
  type TrajectoryStatus,
  type TrajectoryStep,
} from '../features/conversation/trajectory';

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

function iconFor(kind: TrajectoryKind) {
  switch (kind) {
    case 'user': return User;
    case 'assistant': return Bot;
    case 'tool': return Wrench;
    case 'compaction': return Package;
    case 'turn-end': return ListChecks;
  }
}

function statusClass(status: TrajectoryStatus): string {
  switch (status) {
    case 'error': return 'text-destructive';
    case 'running': return 'text-primary';
    case 'aborted': return 'text-warning';
    default: return 'text-muted-foreground';
  }
}

export function TrajectoryScreen() {
  const steps = useDshStore((s) => s.sessionView.trajectory);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const summary = useMemo(() => summarizeTrajectory(steps), [steps]);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="轨迹" />
      <ScrollView contentContainerClassName="gap-3 p-4">
        <View className="border-border/60 bg-card flex-row rounded-xl border p-3">
          <SummaryCell label="回合" value={String(summary.turns)} />
          <SummaryCell label="工具" value={String(summary.tools)} />
          <SummaryCell label="工具耗时" value={formatMs(summary.toolMs)} />
          <SummaryCell label="错误" value={String(summary.errors)} danger={summary.errors > 0} />
        </View>

        {activeSessionId === null ? (
          <Text className="text-muted-foreground py-10 text-center text-sm">未打开会话</Text>
        ) : steps.length === 0 ? (
          <Text className="text-muted-foreground py-10 text-center text-sm">暂无轨迹事件</Text>
        ) : (
          <View className="border-border/60 bg-card overflow-hidden rounded-xl border">
            {steps.map((step, index) => (
              <StepRow
                key={`${step.seq}-${index}`}
                step={step}
                last={index === steps.length - 1}
                expanded={expanded === index}
                onToggle={() => setExpanded(expanded === index ? null : index)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SummaryCell({
  label,
  value,
  danger = false,
}: Readonly<{ label: string; value: string; danger?: boolean }>) {
  return (
    <View className="flex-1 items-center gap-0.5">
      <Text className={danger ? 'text-destructive text-base font-bold' : 'text-foreground text-base font-bold'}>
        {value}
      </Text>
      <Text className="text-muted-foreground text-[11px]">{label}</Text>
    </View>
  );
}

function StepRow({
  step,
  last,
  expanded,
  onToggle,
}: Readonly<{
  step: TrajectoryStep;
  last: boolean;
  expanded: boolean;
  onToggle: () => void;
}>) {
  const IconComponent = iconFor(step.kind);
  const hasDetail = step.detail !== undefined && step.detail.length > 0;
  return (
    <View>
      <Pressable
        className="flex-row items-center gap-3 px-3 py-3 active:bg-accent/40"
        disabled={!hasDetail}
        onPress={onToggle}
        accessibilityRole={hasDetail ? 'button' : undefined}
      >
        <Icon as={IconComponent} className={`size-4 ${statusClass(step.status)}`} />
        <View className="flex-1 gap-0.5">
          <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
            {step.label}
          </Text>
          <Text className="text-muted-foreground text-[11px]" numberOfLines={expanded ? undefined : 1}>
            T{step.turn} · #{step.seq}
            {step.tokensIn !== undefined ? ` · ${step.tokensIn} in` : ''}
            {step.tokensOut !== undefined ? ` / ${step.tokensOut} out` : ''}
            {hasDetail && !expanded ? ` · ${step.detail}` : ''}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          {step.status === 'error' ? (
            <Icon as={CircleAlert} className="text-destructive size-3.5" />
          ) : step.status === 'ok' ? (
            <Icon as={CircleCheck} className="text-muted-foreground size-3.5" />
          ) : null}
          {step.kind === 'tool' || step.durationMs !== null ? (
            <View className="flex-row items-center gap-0.5">
              <Icon as={Clock} className="text-muted-foreground size-3" />
              <Text className={`text-[11px] ${statusClass(step.status)}`}>
                {step.status === 'running' ? '进行中' : formatMs(step.durationMs)}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {expanded && hasDetail ? (
        <View className="bg-muted/40 px-3 pb-3">
          <Text className="text-muted-foreground font-mono text-[12px] leading-5">
            {step.detail}
          </Text>
        </View>
      ) : null}
      {!last ? <Separator className="bg-border/60" /> : null}
    </View>
  );
}
