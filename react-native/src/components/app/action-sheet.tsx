import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { CheckCircle2, ChevronRight, Monitor } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react-native';
import { IconBadge, type IconBadgeHue } from './icon-badge';

export type ActionSheetItem = Readonly<{
  key: string;
  label: string;
  icon: LucideIcon;
  hue?: IconBadgeHue;
  /** true = 两列卡片按钮；false = 整行列表项（带右箭头） */
  cell?: boolean;
  onPress: () => void;
}>;

export type ActionSheetSection = Readonly<{
  title?: string;
  items: readonly ActionSheetItem[];
}>;

/**
 * 底部动作面板内容（shadcn 风格）：组标题 + 两列卡片 / 整行列表。
 *
 * 本组件只负责内容排版，外壳沿用 `design-system/Sheet`（@gorhom），
 * 因此可以直接塞进 `<Sheet>` 的 children。
 */
export function ActionSheetContent({
  sections,
  footer,
}: Readonly<{ sections: readonly ActionSheetSection[]; footer?: React.ReactNode }>) {
  return (
    <View>
      {sections.map((section, index) => {
        const cells = section.items.filter((item) => item.cell === true);
        const rows = section.items.filter((item) => item.cell !== true);
        return (
          <View key={section.title ?? `section-${index}`} className="mb-4">
            {section.title !== undefined ? (
              <Text className="text-muted-foreground px-1 pb-2 text-sm font-medium">
                {section.title}
              </Text>
            ) : null}
            {cells.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {cells.map((item) => (
                  <ActionSheetCell key={item.key} item={item} />
                ))}
              </View>
            ) : null}
            {rows.length > 0 ? (
              <View className="bg-card border-border overflow-hidden rounded-xl border">
                {rows.map((item, rowIndex) => (
                  <ActionSheetRow
                    key={item.key}
                    item={item}
                    last={rowIndex === rows.length - 1}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {footer !== undefined ? (
        <Text className="text-muted-foreground pb-1 text-center text-xs">{footer}</Text>
      ) : null}
    </View>
  );
}

function ActionSheetCell({ item }: Readonly<{ item: ActionSheetItem }>) {
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      className="bg-card border-border w-[48.5%] flex-row items-center gap-2.5 rounded-lg border px-3 py-3 active:bg-accent"
      onPress={item.onPress}
    >
      <IconBadge as={item.icon} hue={item.hue ?? 'blue'} size="lg" />
      <Text className="flex-1 text-sm font-medium" numberOfLines={2}>
        {item.label}
      </Text>
      <Icon as={ChevronRight} className="text-muted-foreground size-4" />
    </Pressable>
  );
}

function ActionSheetRow({
  item,
  last,
}: Readonly<{ item: ActionSheetItem; last: boolean }>) {
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      className={cn(
        'flex-row items-center gap-3 px-4 py-3 active:bg-accent',
        !last && 'border-border border-b',
      )}
      onPress={item.onPress}
    >
      <IconBadge as={item.icon} hue={item.hue ?? 'blue'} size="lg" />
      <Text className="flex-1 text-sm font-medium">{item.label}</Text>
      <Icon as={ChevronRight} className="text-muted-foreground size-4" />
    </Pressable>
  );
}

/** 设备行（Worker 选择 / 查找 / 我的 Worker 列表共用）。 */
export function DeviceRow({
  title,
  subtitle,
  image,
  status,
  selected = false,
  onPress,
  className,
}: Readonly<{
  title: string;
  subtitle?: React.ReactNode;
  /** 设备缩略图；缺省时用图标块占位 */
  image?: React.ComponentProps<typeof Image>['source'];
  status?: Readonly<{ label: string; tone: 'online' | 'offline' | 'pending' }>;
  selected?: boolean;
  onPress?: () => void;
  className?: string;
}>) {
  const toneClass =
    status?.tone === 'online'
      ? 'bg-success'
      : status?.tone === 'pending'
        ? 'bg-warning'
        : 'bg-muted-foreground';
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole={onPress !== undefined ? 'button' : undefined}
      className={cn(
        'bg-card border-border flex-row items-center gap-3 rounded-xl border px-4 py-3',
        onPress !== undefined && 'active:bg-accent',
        selected && 'border-primary',
        className,
      )}
      disabled={onPress === undefined}
      onPress={onPress}
    >
      {image !== undefined ? (
        <Image className="h-10 w-10 rounded-md" resizeMode="contain" source={image} />
      ) : (
        <View className="bg-muted h-10 w-10 items-center justify-center rounded-md">
          <Icon as={Monitor} className="text-muted-foreground size-5" />
        </View>
      )}
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text className="text-muted-foreground mt-0.5 text-xs" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {status !== undefined ? (
        <View className="flex-row items-center gap-1.5">
          <View className={cn('h-1.5 w-1.5 rounded-full', toneClass)} />
          <Text className="text-muted-foreground text-xs">{status.label}</Text>
        </View>
      ) : null}
      {selected ? <Icon as={CheckCircle2} className="text-primary size-5" /> : null}
      {!selected && onPress !== undefined ? (
        <Icon as={ChevronRight} className="text-muted-foreground size-4" />
      ) : null}
    </Pressable>
  );
}
