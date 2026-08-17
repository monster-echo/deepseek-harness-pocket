import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { NotificationItem } from '../domain/models';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

export function NotificationCard({
  item,
  onPress,
}: Readonly<{ item: NotificationItem; onPress: () => void }>) {
  const { palette } = usePreferences();
  const unread = !item.readAt;
  return (
    <Pressable
      accessibilityHint={item.route ? '打开相关页面' : '标记为已读'}
      accessibilityLabel={`${unread ? '未读通知' : '通知'}：${item.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        cardStyles.card,
        {
          backgroundColor: unread ? palette.brandSoft : palette.surface,
          borderColor: unread ? colors.brand : palette.border,
        },
        pressed && cardStyles.pressed,
      ]}
    >
      <View style={[cardStyles.icon, { backgroundColor: palette.surfaceMuted }]}>
        <AppIcon name={notificationIcon(item.type)} color={notificationColor(item.type)} size={22} />
      </View>
      <View style={cardStyles.content}>
        <View style={cardStyles.titleRow}>
          <Text numberOfLines={1} style={[styles.body, cardStyles.title]}>
            {item.title}
          </Text>
          {unread ? <View accessibilityLabel="未读" style={cardStyles.unreadDot} /> : null}
        </View>
        <Text numberOfLines={2} style={[styles.secondary, cardStyles.message]}>
          {item.body}
        </Text>
        <Text style={styles.caption}>{relativeTime(item.createdAt)}</Text>
      </View>
      {item.route ? (
        <AppIcon name="chevron-right" color={palette.textSecondary} size={18} />
      ) : null}
    </Pressable>
  );
}

function notificationIcon(type: string): IconName {
  if (type === 'membership') return 'crown';
  if (type === 'order' || type === 'billing') return 'gift';
  if (type === 'security') return 'lock';
  return 'bell';
}

function notificationColor(type: string) {
  if (type === 'membership') return colors.membershipGold;
  if (type === 'security') return colors.warning;
  if (type === 'order' || type === 'billing') return colors.success;
  return colors.info;
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

const cardStyles = StyleSheet.create({
  card: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    padding: spacing.x4,
    borderRadius: radii.card,
    borderWidth: 1,
  },
  pressed: { opacity: 0.76 },
  icon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.round,
  },
  content: { flex: 1, gap: spacing.x1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  title: { flex: 1, fontWeight: '700' },
  message: { lineHeight: 20 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radii.round,
    backgroundColor: colors.brand,
  },
});
