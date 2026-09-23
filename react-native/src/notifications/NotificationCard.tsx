import React from 'react';
import { Pressable, View } from 'react-native';
import { Bell, ChevronRight, Crown, Gift, Lock, type LucideIcon } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { NotificationItem } from '../domain/models';

export function NotificationCard({
  item,
  onPress,
}: Readonly<{ item: NotificationItem; onPress: () => void }>) {
  const unread = !item.readAt;
  const TypeIcon = notificationIcon(item.type);
  return (
    <Pressable
      accessibilityHint={item.route ? '打开相关页面' : '标记为已读'}
      accessibilityLabel={`${unread ? '未读通知' : '通知'}：${item.title}`}
      accessibilityRole="button"
      onPress={onPress}
      className={cn(
        'min-h-[104px] flex-row items-center gap-3 rounded-2xl border p-4 active:opacity-75',
        unread ? 'border-primary bg-primary/10' : 'border-border bg-card',
      )}
    >
      <View className="bg-muted h-[46px] w-[46px] items-center justify-center rounded-full">
        <Icon as={TypeIcon} className={notificationColor(item.type)} size={22} />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="flex-1 text-base font-bold">
            {item.title}
          </Text>
          {unread ? <View accessibilityLabel="未读" className="bg-primary h-2 w-2 rounded-full" /> : null}
        </View>
        <Text numberOfLines={2} className="text-muted-foreground text-sm leading-5">
          {item.body}
        </Text>
        <Text className="text-muted-foreground text-xs">{relativeTime(item.createdAt)}</Text>
      </View>
      {item.route ? (
        <Icon as={ChevronRight} className="text-muted-foreground" size={18} />
      ) : null}
    </Pressable>
  );
}

function notificationIcon(type: string): LucideIcon {
  if (type === 'membership') return Crown;
  if (type === 'order' || type === 'billing') return Gift;
  if (type === 'security') return Lock;
  return Bell;
}

function notificationColor(type: string) {
  if (type === 'membership') return 'text-warning';
  if (type === 'security') return 'text-warning';
  if (type === 'order' || type === 'billing') return 'text-success';
  return 'text-primary';
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const difference = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}
