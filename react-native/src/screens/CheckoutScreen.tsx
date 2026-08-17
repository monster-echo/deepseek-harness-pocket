import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AppButton, AppCard, PageHeader } from '../design-system/components';
import { useApp } from '../state/AppStore';
import { styles } from '../theme/styles';
import { formatPrice } from './MembershipScreen';

export function CheckoutScreen() {
  const { config, navigate, purchaseState, purchase, busy, pendingPlanId } = useApp();
  const planId = pendingPlanId;
  const plan = config.plans.find((p) => p.id === planId);
  const start = async () => {
    if (!planId) return;
    await purchase(planId);
  };
  const st = purchaseState?.kind;
  return (
    <View style={styles.page}>
      <PageHeader title="确认订阅" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <Text style={styles.heading}>{plan?.name ?? planId}</Text>
          {plan ? <Text style={styles.secondary}>{formatPrice(plan)}</Text> : null}
          {plan?.provider === 'mock' ? <Text style={styles.caption}>演示支付：通过模拟渠道完成。</Text> : null}
        </AppCard>
        {st === 'loading' ? (
          <AppButton disabled label="正在确认…" icon="crown" onPress={() => {}} />
        ) : st === 'success' ? (
          <AppButton label="完成" icon="check" onPress={() => navigate('membership.home')} />
        ) : st === 'failed' ? (
          <AppButton label="重试" icon="crown" onPress={() => void start()} />
        ) : (
          <AppButton disabled={busy} label="确认订阅" icon="crown" onPress={() => void start()} />
        )}
      </ScrollView>
    </View>
  );
}
