import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

export type SegmentedItem<T extends string> = Readonly<{
  value: T;
  label: string;
  /** 右侧角标数字（如「需要处理 2」） */
  badge?: number;
}>;

/**
 * 分段控件（shadcn Tabs 的 pill/segmented 变体）。
 *
 * 形态：`bg-muted` 轨道 + `bg-background` 选中块 + `shadow-sm`，
 * 与 shadcn 的 `<TabsList />` 视觉一致；受控组件，调用方持有 value。
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  className,
}: Readonly<{
  items: readonly SegmentedItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}>) {
  return (
    <View
      className={cn(
        'bg-muted text-muted-foreground inline-flex flex-row items-center rounded-lg p-1',
        className,
      )}
      accessibilityRole="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className={cn(
              'min-h-[32px] flex-1 flex-row items-center justify-center gap-1.5 rounded-md px-3',
              active && 'bg-background shadow-sm',
            )}
            onPress={() => onChange(item.value)}
          >
            <Text
              className={cn(
                'text-sm',
                active ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </Text>
            {item.badge !== undefined && item.badge > 0 ? (
              <View className="bg-primary min-w-[16px] items-center rounded-full px-1">
                <Text className="text-primary-foreground text-[10px] font-semibold">
                  {item.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
