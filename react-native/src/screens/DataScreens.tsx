import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, TriangleAlert } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { NotificationItem, OrderView } from '../domain/models';
import type { OrderStatus } from '../payment/paymentModels';
import { AppRoute } from '../navigation/routes';
import { useApp } from '../state/AppStore';
import { useDshStore } from '../state/dshStore';
import { NotificationCard } from '../notifications/NotificationCard';

/** RNR 顶栏：返回键（React Navigation canGoBack）+ 居中标题 + 右侧动作。 */
function ScreenHeader({ title, rightAction }: Readonly<{
  title: string;
  rightAction?: Readonly<{ label: string; onPress: () => void; disabled?: boolean }>;
}>) {
  const navigation = useNavigation();
  const canGoBack = navigation.canGoBack();
  return (
    <View className="border-border/60 h-[58px] flex-row items-center justify-between border-b px-2">
      <View className="w-[88px] items-start">
        {canGoBack ? (
          <Button
            accessibilityLabel="返回"
            onPress={() => navigation.goBack()}
            size="icon"
            variant="ghost"
          >
            <Icon as={ArrowLeft} className="size-5" />
          </Button>
        ) : null}
      </View>
      <Text className="absolute left-[88px] right-[88px] text-center text-[17px] font-bold">
        {title}
      </Text>
      <View className="w-[88px] items-end">
        {rightAction ? (
          <Button
            accessibilityLabel={rightAction.label}
            disabled={rightAction.disabled}
            onPress={rightAction.onPress}
            size="sm"
            variant="ghost"
          >
            <Text className="text-sm font-bold">{rightAction.label}</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

/** 离线提示条（原 design-system OfflineBanner 的就地 RNR 版）。 */
function OfflineBanner() {
  const { online, refreshBootstrap } = useApp();
  if (online) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="bg-muted min-h-10 flex-row items-center justify-center gap-2 px-4"
      onPress={() => void refreshBootstrap()}
    >
      <Icon as={TriangleAlert} className="size-[18px]" />
      <Text className="text-xs font-semibold">当前离线，正在使用本地配置 · 点击重试</Text>
    </Pressable>
  );
}

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
    <View className="bg-background flex-1">
      <OfflineBanner />
      <ScreenHeader
        title="通知中心"
        rightAction={items.length ? {
          label: '全部已读',
          onPress: () => void readAll(),
          disabled: unreadCount === 0,
        } : undefined}
      />
      <ScrollView contentContainerClassName="gap-4 p-4">
        {items.length ? (
          <View className="min-h-[56px] justify-center gap-1">
            <View>
              <Text className="text-xl font-bold">最新通知</Text>
              <Text className="text-muted-foreground text-xs">
                共 {items.length} 条通知 · {unreadCount} 条未读
              </Text>
            </View>
          </View>
        ) : null}
        {items.map((item) => (
          <NotificationCard key={item.id} item={item} onPress={() => void open(item)} />
        ))}
        {!items.length ? (
          <Text className="text-muted-foreground text-sm">{user ? '暂无通知。' : '登录后查看通知。'}</Text>
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
    <View className="bg-background flex-1">
      <ScreenHeader title="订单管理" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        {orders.map((order) => (
          <Card key={order.id} className="gap-0 py-0">
            <CardContent className="gap-3 py-4">
              <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
                <Text className="flex-1 text-base">{order.planId}</Text>
                <Text className="text-muted-foreground text-sm">{statusLabel(order.status)}</Text>
              </View>
              <Text className="text-muted-foreground text-sm">
                {formatMoney(order.amountMinor, order.currency)} · {order.provider}
              </Text>
              <Text className="text-muted-foreground text-xs">{formatDate(order.createdAt)}</Text>
            </CardContent>
          </Card>
        ))}
        {!orders.length ? (
          <Text className="text-muted-foreground text-sm">{user ? '暂无订单。' : '登录后查看订单。'}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function AboutScreen() {
  const { config, online } = useApp();
  const handshake = useDshStore((s) => s.workerHandshake);
  const activeWorker = useDshStore((s) => s.workers.find((w) => w.workerId === s.activeWorkerId));
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="关于与版本" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <Text className="text-xl font-bold">{config.brand.appName}</Text>
            <Text className="text-muted-foreground text-sm">{config.brand.tagline}</Text>
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">客户端版本</Text>
              <Text className="text-muted-foreground text-sm">1.0.0</Text>
            </View>
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">配置版本</Text>
              <Text className="text-muted-foreground text-sm">{`v${config.version}`}</Text>
            </View>
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">配置 Schema</Text>
              <Text className="text-muted-foreground text-sm">{`v${config.schemaVersion}`}</Text>
            </View>
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">服务状态</Text>
              <Text className="text-muted-foreground text-sm">{online ? '在线' : '离线缓存'}</Text>
            </View>
          </CardContent>
        </Card>
        {/* Worker 信息（替代桌面「打开配置文件」：展示当前 worker 的指纹/协议/版本） */}
        {handshake !== null && (
          <Card className="gap-0 py-0">
            <CardContent className="gap-3 py-4">
              <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
                <Text className="flex-1 text-base">Worker 名称</Text>
                <Text className="text-muted-foreground text-sm">{activeWorker?.name ?? handshake.name}</Text>
              </View>
              <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
                <Text className="flex-1 text-base">主机指纹</Text>
                <Text className="text-muted-foreground text-sm">{handshake.fingerprint.slice(0, 12)}</Text>
              </View>
              <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
                <Text className="flex-1 text-base">协议版本</Text>
                <Text className="text-muted-foreground text-sm">{handshake.protocolVersion}</Text>
              </View>
            </CardContent>
          </Card>
        )}
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
