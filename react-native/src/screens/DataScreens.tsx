import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AppCard,
  ListRow,
  OfflineBanner,
  PageHeader,
} from '../design-system/components';
import { NotificationItem, OrderView } from '../domain/models';
import type { OrderStatus } from '../payment/paymentModels';
import { AppRoute } from '../navigation/routes';
import { useApp } from '../state/AppStore';
import { styles } from '../theme/styles';
import { NotificationCard } from '../notifications/NotificationCard';
import { spacing } from '../theme/tokens';

export function NotificationsScreen() {
  const {
    user,
    loadNotifications,
    markNotificationsRead,
    markNotificationRead,
    navigate,
  } = useApp();
  const [items, setItems] = useState<readonly NotificationItem[]>([]);
  useEffect(() => {
    if (user) void loadNotifications().then(setItems);
  }, [loadNotifications, user]);
  const readAll = async () => {
    await markNotificationsRead();
    const timestamp = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? timestamp })));
  };
  const open = async (item: NotificationItem) => {
    if (!item.readAt) {
      await markNotificationRead(item.id);
      const timestamp = new Date().toISOString();
      setItems((current) => current.map((value) => (
        value.id === item.id ? { ...value, readAt: timestamp } : value
      )));
    }
    if (isAppRoute(item.route)) navigate(item.route);
  };
  const unreadCount = items.filter((item) => !item.readAt).length;
  return (
    <View style={styles.page}>
      <OfflineBanner />
      <PageHeader
        title="通知中心"
        rightAction={items.length ? {
          label: '全部已读',
          onPress: () => void readAll(),
          disabled: unreadCount === 0,
        } : undefined}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {items.length ? (
          <View style={notificationStyles.toolbar}>
            <View>
              <Text style={styles.heading}>最新通知</Text>
              <Text style={styles.caption}>
                共 {items.length} 条通知 · {unreadCount} 条未读
              </Text>
            </View>
          </View>
        ) : null}
        {items.map((item) => (
          <NotificationCard key={item.id} item={item} onPress={() => void open(item)} />
        ))}
        {!items.length ? (
          <Text style={styles.secondary}>{user ? '暂无通知。' : '登录后查看通知。'}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function OrdersScreen() {
  const { user, loadOrders } = useApp();
  const [orders, setOrders] = useState<readonly OrderView[]>([]);
  useEffect(() => {
    if (user) void loadOrders().then(setOrders);
  }, [loadOrders, user]);
  return (
    <View style={styles.page}>
      <PageHeader title="订单管理" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {orders.map((order) => (
          <AppCard key={order.id}>
            <ListRow label={order.planId} value={statusLabel(order.status)} />
            <Text style={styles.secondary}>
              {formatMoney(order.amountMinor, order.currency)} · {order.provider}
            </Text>
            <Text style={styles.caption}>{formatDate(order.createdAt)}</Text>
          </AppCard>
        ))}
        {!orders.length ? (
          <Text style={styles.secondary}>{user ? '暂无订单。' : '登录后查看订单。'}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function AboutScreen() {
  const { config, online } = useApp();
  return (
    <View style={styles.page}>
      <PageHeader title="关于与版本" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <Text style={styles.heading}>{config.brand.appName}</Text>
          <Text style={styles.secondary}>{config.brand.tagline}</Text>
        </AppCard>
        <AppCard>
          <ListRow label="客户端版本" value="1.0.0" />
          <ListRow label="配置版本" value={`v${config.version}`} />
          <ListRow label="配置 Schema" value={`v${config.schemaVersion}`} />
          <ListRow label="服务状态" value={online ? '在线' : '离线缓存'} />
        </AppCard>
      </ScrollView>
    </View>
  );
}

function isAppRoute(value: string | null): value is AppRoute {
  return Boolean(value && !value.includes('://'));
}

const statusLabel = (status: OrderStatus): string => ({
  pending: '待支付', processing: '处理中', success: '已生效', failed: '失败', refunded: '已退款',
}[status] ?? status);

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount / 100);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

const notificationStyles = StyleSheet.create({
  toolbar: {
    minHeight: 56,
    justifyContent: 'center',
    gap: spacing.x1,
  },
});
