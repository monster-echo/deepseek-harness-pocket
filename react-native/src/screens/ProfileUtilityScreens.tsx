import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { CouponView, ReferralView, UsageSummary } from '../domain/models';
import { useApp } from '../state/AppStore';
import { telemetry } from '../telemetry/Telemetry';
import type { AppRoute } from '../navigation/routes';

type ViewState<T> =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'success'; data: T }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'error'; message: string }>;

type ActionButtonVariant = 'primary' | 'secondary' | 'danger';

function AppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  analyticsId,
  testID,
}: Readonly<{
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  analyticsId?: string;
  testID?: string;
}>) {
  const foreground = useCSSVariable([
    '--color-primary-foreground',
    '--color-foreground',
    '--color-destructive-foreground',
  ]) as [string, string, string];
  const iconColor =
    variant === 'secondary' ? foreground[1] : variant === 'danger' ? foreground[2] : foreground[0];
  return (
    <Button
      accessibilityRole="button"
      className="min-h-[52px] w-full"
      disabled={disabled}
      testID={testID}
      variant={variant === 'primary' ? 'default' : variant === 'danger' ? 'destructive' : 'outline'}
      onPress={() => {
        telemetry.track('ui_action', { action_id: analyticsId ?? `button.${label}` });
        onPress();
      }}
    >
      {icon ? <AppIcon name={icon} color={iconColor} size={20} /> : null}
      <Text>{label}</Text>
    </Button>
  );
}

function PageHeader({ title }: Readonly<{ title: string }>) {
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
            <AppIcon name="arrow-left" size={20} />
          </Button>
        ) : null}
      </View>
      <Text className="absolute left-[88px] right-[88px] text-center text-[17px] font-bold">
        {title}
      </Text>
      <View className="w-[88px] items-end" />
    </View>
  );
}

function AppCard({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="gap-3 py-4">{children}</CardContent>
    </Card>
  );
}

function ListRow({
  label,
  route,
  icon,
  value,
  onPress,
}: Readonly<{
  label: string;
  route?: AppRoute;
  icon?: IconName;
  value?: string;
  onPress?: () => void;
}>) {
  const { navigate } = useApp();
  const action = onPress ?? (route ? () => navigate(route) : undefined);
  return (
    <Pressable
      className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
      disabled={!action}
      onPress={action ? () => {
        telemetry.track('ui_action', { action_id: route ?? `row.${label}` });
        action();
      } : undefined}
    >
      {icon ? <AppIcon name={icon} size={20} /> : null}
      <Text className="flex-1 text-base">{label}</Text>
      {value ? <Text className="text-muted-foreground text-sm">{value}</Text> : null}
      {action ? <AppIcon name="chevron-right" size={18} /> : null}
    </Pressable>
  );
}

export function StatisticsScreen() {
  const { loadUsage } = useApp();
  const [state, setState] = useState<ViewState<UsageSummary>>({ status: 'loading' });
  useEffect(() => { void load(loadUsage, setState, (value) => value.screens.length === 0); }, [loadUsage]);
  return (
    <View className="bg-background flex-1">
      <PageHeader title="使用统计" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <StateMessage state={state} retry={() => void load(loadUsage, setState, () => false)} />
        {state.status === 'success' ? <UsageContent usage={state.data} /> : null}
        {state.status === 'empty' ? <Text className="text-muted-foreground text-sm">开始使用后，这里会显示匿名聚合数据。</Text> : null}
      </ScrollView>
    </View>
  );
}

function UsageContent({ usage }: Readonly<{ usage: UsageSummary }>) {
  return (
    <>
      <AppCard>
        <ListRow label="会话次数" value={String(usage.sessions)} />
        <ListRow label="页面浏览" value={String(usage.screenViews)} />
        <ListRow label="活跃时长" value={`${usage.activeMinutes} 分钟`} />
      </AppCard>
      {usage.screens.map((screen) => (
        <AppCard key={screen.screenId}>
          <ListRow label={screen.screenId} value={`${screen.views} 次`} />
          <Text className="text-muted-foreground text-xs">停留 {Math.round(screen.durationMs / 1000)} 秒</Text>
        </AppCard>
      ))}
    </>
  );
}

export function CouponsScreen() {
  const { loadCoupons } = useApp();
  const [state, setState] = useState<ViewState<readonly CouponView[]>>({ status: 'loading' });
  useEffect(() => { void load(loadCoupons, setState, (items) => items.length === 0); }, [loadCoupons]);
  return (
    <View className="bg-background flex-1">
      <PageHeader title="优惠券" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <StateMessage state={state} retry={() => void load(loadCoupons, setState, (items) => !items.length)} />
        {state.status === 'empty' ? <Text className="text-muted-foreground text-sm">当前账户暂无可用优惠券。</Text> : null}
        {state.status === 'success' ? state.data.map((coupon) => <CouponCard key={coupon.id} coupon={coupon} />) : null}
      </ScrollView>
    </View>
  );
}

function CouponCard({ coupon }: Readonly<{ coupon: CouponView }>) {
  const status = coupon.usedAt ? '已使用' : coupon.expiresAt && Date.parse(coupon.expiresAt) < Date.now() ? '已过期' : '可使用';
  return (
    <AppCard>
      <Text className="text-foreground text-xl font-bold">{coupon.title}</Text>
      <Text className="text-foreground text-base">{coupon.discountLabel}</Text>
      <ListRow label="券码" value={coupon.code} />
      <Text className="text-muted-foreground text-xs">{status}</Text>
    </AppCard>
  );
}

export function InviteScreen() {
  const { loadReferral } = useApp();
  const [state, setState] = useState<ViewState<ReferralView>>({ status: 'loading' });
  useEffect(() => { void load(loadReferral, setState, () => false); }, [loadReferral]);
  const share = async (referral: ReferralView) => {
    await Share.share({ message: `使用邀请码 ${referral.code} 加入：${referral.shareUrl}` });
  };
  return (
    <View className="bg-background flex-1">
      <PageHeader title="邀请好友" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <StateMessage state={state} retry={() => void load(loadReferral, setState, () => false)} />
        {state.status === 'success' ? (
          <AppCard>
            <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wide">我的邀请码</Text>
            <Text selectable className="text-foreground text-[28px] font-bold">{state.data.code}</Text>
            <Text className="text-muted-foreground text-sm">已邀请 {state.data.invited} 位好友</Text>
            <AppButton label="分享邀请" icon="gift" onPress={() => void share(state.data)} />
          </AppCard>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StateMessage<T>({ state, retry }: Readonly<{ state: ViewState<T>; retry: () => void }>) {
  if (state.status === 'loading') return <Text className="text-muted-foreground text-sm">正在加载…</Text>;
  if (state.status !== 'error') return null;
  return (
    <AppCard>
      <Text className="text-muted-foreground text-sm">{state.message}</Text>
      <AppButton label="重试" icon="alert" onPress={retry} variant="secondary" />
    </AppCard>
  );
}

async function load<T>(
  operation: () => Promise<T>,
  update: React.Dispatch<React.SetStateAction<ViewState<T>>>,
  empty: (value: T) => boolean,
) {
  update({ status: 'loading' });
  try {
    const value = await operation();
    update(empty(value) ? { status: 'empty' } : { status: 'success', data: value });
  } catch (error) {
    update({ status: 'error', message: error instanceof Error ? error.message : '加载失败' });
  }
}
