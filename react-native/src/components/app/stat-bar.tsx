import React from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react-native';

export type StatBarTone = 'primary' | 'success' | 'warning' | 'destructive';

const FILL: Record<StatBarTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

/**
 * 指标条（Worker 详情的 CPU / 内存）。
 * 行形态：`[图标] 标签 [========----] 数值`
 */
export function StatBar({
  label,
  icon,
  value,
  valueLabel,
  tone = 'primary',
  className,
}: Readonly<{
  label: string;
  icon?: LucideIcon;
  /** 0–1，超出会被夹取 */
  value: number;
  valueLabel?: string;
  tone?: StatBarTone;
  className?: string;
}>) {
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const WIDTH_STEPS = 100;
  const filled = Math.round(ratio * WIDTH_STEPS);
  return (
    <View className={cn('flex-row items-center gap-3 py-2.5', className)}>
      {icon !== undefined ? (
        <Icon as={icon} className="text-muted-foreground size-[18px]" />
      ) : null}
      <Text className="w-14 shrink-0 text-[15px]">{label}</Text>
      <View className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
        <View
          className={cn('h-full rounded-full', FILL[tone])}
          style={{ width: `${filled}%` }}
        />
      </View>
      {valueLabel !== undefined ? (
        <Text className="text-muted-foreground shrink-0 text-[15px] tabular-nums">
          {valueLabel}
        </Text>
      ) : null}
    </View>
  );
}
