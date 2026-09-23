import React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/**
 * 分组容器（shadcn 风格）：`border + bg-card + rounded-xl`，
 * 组标题在卡外，组尾说明在卡下。
 *
 * 与 shadcn 的 Card 组件差别：Card 是通用卡片，本组件额外提供
 * 「组标题 / 组尾说明」的排版约定，供设置页、我的页、Worker 页复用。
 */
export function ListGroup({
  children,
  header,
  footer,
  className,
}: Readonly<{
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}>) {
  return (
    <View className={cn('mb-4', className)}>
      {header !== undefined ? <SectionHeader>{header}</SectionHeader> : null}
      <View className="bg-card border-border overflow-hidden rounded-xl border">
        {children}
      </View>
      {footer !== undefined ? (
        <Text className="text-muted-foreground px-1 pt-2 text-xs leading-4">{footer}</Text>
      ) : null}
    </View>
  );
}

/** 组标题（shadcn 里对应 Card 上方的 `text-sm font-medium text-muted-foreground`）。 */
export function SectionHeader({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return (
    <Text className={cn('text-muted-foreground px-1 pb-2 text-sm font-medium', className)}>
      {children}
    </Text>
  );
}

/** 行间分隔线（shadcn 列表用 `border-b`，最后一行不画）。 */
export function ListSeparator() {
  return <View className="bg-border h-px w-full" accessibilityElementsHidden />;
}

/**
 * 通用行（shadcn 列表行）。
 *
 * 形态：`[icon] 标题(+副标题) ……… [右值] [箭头/开关]`
 * - 有 onPress → Pressable（hover/active 用 `bg-accent`）；
 * - `switchValue` 传入即渲染开关（行本身仍可点按）；
 * - `danger` 用于「退出登录 / 移除 Worker」这类破坏性行（`text-destructive`）。
 */
export function ListRow({
  title,
  subtitle,
  leading,
  value,
  accessory,
  switchValue,
  onSwitchChange,
  onPress,
  onLongPress,
  danger = false,
  disabled = false,
  showChevron = false,
  minHeight = 48,
  className,
  titleClassName,
  accessibilityLabel,
  testID,
}: Readonly<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  value?: React.ReactNode;
  accessory?: React.ReactNode;
  switchValue?: boolean;
  onSwitchChange?: (next: boolean) => void;
  onPress?: () => void;
  onLongPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
  minHeight?: number;
  className?: string;
  titleClassName?: string;
  accessibilityLabel?: string;
  testID?: string;
}>) {
  const body = (
    <>
      {leading !== undefined ? <View className="shrink-0">{leading}</View> : null}
      <View className="min-w-0 flex-1">
        <Text
          className={cn(
            'text-sm leading-5',
            danger ? 'text-destructive' : 'text-foreground',
            subtitle !== undefined ? 'font-medium' : 'font-normal',
            titleClassName,
          )}
          numberOfLines={subtitle !== undefined ? 1 : 2}
        >
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text className="text-muted-foreground mt-0.5 text-xs leading-4">{subtitle}</Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <Text className="text-muted-foreground ml-3 shrink-0 text-sm">{value}</Text>
      ) : null}
      {accessory !== undefined ? <View className="ml-2 shrink-0">{accessory}</View> : null}
      {switchValue !== undefined ? (
        <View className="ml-3 shrink-0">
          <Switch
            checked={switchValue}
            disabled={disabled}
            onCheckedChange={onSwitchChange ?? (() => undefined)}
          />
        </View>
      ) : null}
      {showChevron ? (
        <Icon as={ChevronRight} className="text-muted-foreground ml-1 size-4 shrink-0" />
      ) : null}
    </>
  );

  const rowClassName = cn(
    'flex-row items-center gap-3 px-4',
    disabled && 'opacity-50',
    className,
  );
  const rowStyle = { minHeight };

  if (onPress === undefined && onLongPress === undefined) {
    return (
      <View className={rowClassName} style={rowStyle} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className={cn(rowClassName, 'active:bg-accent')}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      style={rowStyle}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}
