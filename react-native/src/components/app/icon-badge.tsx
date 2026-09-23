import React from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react-native';

/** 行首图标的语义色（shadcn 风格：浅底 + 同色系字形）。 */
export type IconBadgeHue = 'blue' | 'violet' | 'orange' | 'green' | 'teal' | 'red' | 'neutral';

const TINT: Record<IconBadgeHue, string> = {
  blue: 'bg-tint-blue',
  violet: 'bg-tint-violet',
  orange: 'bg-tint-orange',
  green: 'bg-tint-green',
  teal: 'bg-tint-teal',
  red: 'bg-tint-red',
  neutral: 'bg-muted',
};

const HUE: Record<IconBadgeHue, string> = {
  blue: 'text-hue-blue',
  violet: 'text-hue-violet',
  orange: 'text-hue-orange',
  green: 'text-hue-green',
  teal: 'text-hue-teal',
  red: 'text-hue-red',
  neutral: 'text-muted-foreground',
};

/**
 * 行首图标容器：圆角浅底 + 同色系图标（shadcn 里常见的 `rounded-md bg-muted p-2` 做法）。
 * 尺寸：`sm` 24 / `md` 32 / `lg` 36 / `xl` 48。
 */
export function IconBadge({
  as,
  hue = 'blue',
  size = 'md',
  className,
}: Readonly<{
  as: LucideIcon;
  hue?: IconBadgeHue;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}>) {
  const box = {
    sm: 'h-6 w-6 rounded-md',
    md: 'h-8 w-8 rounded-md',
    lg: 'h-9 w-9 rounded-lg',
    xl: 'h-12 w-12 rounded-xl',
  }[size];
  const glyph = { sm: 14, md: 16, lg: 18, xl: 24 }[size];
  return (
    <View className={cn('items-center justify-center', box, TINT[hue], className)}>
      <Icon as={as} size={glyph} className={HUE[hue]} />
    </View>
  );
}
