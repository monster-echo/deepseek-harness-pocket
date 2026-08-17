import React, { useEffect, useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { AppButton, AppCard, ListRow, PageHeader } from '../design-system/components';
import { CouponView, ReferralView, UsageSummary } from '../domain/models';
import { useApp } from '../state/AppStore';
import { styles } from '../theme/styles';

type ViewState<T> =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'success'; data: T }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'error'; message: string }>;

export function StatisticsScreen() {
  const { loadUsage } = useApp();
  const [state, setState] = useState<ViewState<UsageSummary>>({ status: 'loading' });
  useEffect(() => { void load(loadUsage, setState, (value) => value.screens.length === 0); }, [loadUsage]);
  return (
    <View style={styles.page}>
      <PageHeader title="使用统计" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <StateMessage state={state} retry={() => void load(loadUsage, setState, () => false)} />
        {state.status === 'success' ? <UsageContent usage={state.data} /> : null}
        {state.status === 'empty' ? <Text style={styles.secondary}>开始使用后，这里会显示匿名聚合数据。</Text> : null}
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
          <Text style={styles.caption}>停留 {Math.round(screen.durationMs / 1000)} 秒</Text>
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
    <View style={styles.page}>
      <PageHeader title="优惠券" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <StateMessage state={state} retry={() => void load(loadCoupons, setState, (items) => !items.length)} />
        {state.status === 'empty' ? <Text style={styles.secondary}>当前账户暂无可用优惠券。</Text> : null}
        {state.status === 'success' ? state.data.map((coupon) => <CouponCard key={coupon.id} coupon={coupon} />) : null}
      </ScrollView>
    </View>
  );
}

function CouponCard({ coupon }: Readonly<{ coupon: CouponView }>) {
  const status = coupon.usedAt ? '已使用' : coupon.expiresAt && Date.parse(coupon.expiresAt) < Date.now() ? '已过期' : '可使用';
  return (
    <AppCard>
      <Text style={styles.heading}>{coupon.title}</Text>
      <Text style={styles.body}>{coupon.discountLabel}</Text>
      <ListRow label="券码" value={coupon.code} />
      <Text style={styles.caption}>{status}</Text>
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
    <View style={styles.page}>
      <PageHeader title="邀请好友" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <StateMessage state={state} retry={() => void load(loadReferral, setState, () => false)} />
        {state.status === 'success' ? (
          <AppCard>
            <Text style={styles.sectionLabel}>我的邀请码</Text>
            <Text selectable style={styles.title}>{state.data.code}</Text>
            <Text style={styles.secondary}>已邀请 {state.data.invited} 位好友</Text>
            <AppButton label="分享邀请" icon="gift" onPress={() => void share(state.data)} />
          </AppCard>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StateMessage<T>({ state, retry }: Readonly<{ state: ViewState<T>; retry: () => void }>) {
  if (state.status === 'loading') return <Text style={styles.secondary}>正在加载…</Text>;
  if (state.status !== 'error') return null;
  return (
    <AppCard>
      <Text style={styles.secondary}>{state.message}</Text>
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
