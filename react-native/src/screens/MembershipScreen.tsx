import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  ListRow,
  PageHeader,
} from "../design-system/components";
import { BillingPlan, MembershipTier } from "../domain/models";
import { useApp } from "../state/AppStore";
import { colors, membershipAccents, radii, spacing } from "../theme/tokens";
import { styles } from "../theme/styles";

export function MembershipScreen() {
  const { config, user, navigate, busy, setPendingPlanId, setPurchaseState } =
    useApp();
  const [selected, setSelected] = useState(config.plans[0]?.id ?? "");
  const selectedPlan = config.plans.find((plan) => plan.id === selected);
  const buy = () => {
    if (!user) {
      navigate("auth.signIn");
      return;
    }
    if (!selected) return;
    setPurchaseState({ kind: "idle" });
    setPendingPlanId(selected);
    navigate("membership.checkout");
  };
  return (
    <View style={styles.page}>
      <PageHeader title="会员中心" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <MembershipHero
          tiers={config.tiers.length}
          plans={config.plans.length}
        />
        {config.tiers.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            current={user?.tierId === tier.id}
          />
        ))}
        <Text style={styles.sectionLabel}>可订阅方案</Text>
        {config.plans.map((plan, index) => (
          <PlanCard
            key={plan.id}
            accent={
              membershipAccents[Math.min(index, membershipAccents.length - 1)]
            }
            plan={plan}
            selected={selected === plan.id}
            select={() => setSelected(plan.id)}
          />
        ))}
        {config.plans.length ? (
          <>
            {selectedPlan?.provider === "mock" ? (
              <AppCard>
                <Text style={styles.secondary}>
                  当前为演示支付，不会调用真实商店或支付渠道。
                </Text>
              </AppCard>
            ) : null}
            <AppButton
              disabled={busy}
              label={busy ? "正在确认…" : !user ? "登录后订阅" : "确认订阅"}
              icon="crown"
              onPress={() => buy()}
            />
          </>
        ) : (
          <Text style={styles.secondary}>当前 App 暂未配置可售方案。</Text>
        )}
        <ListRow label="查看订单记录" route="membership.orders" icon="gift" />
      </ScrollView>
    </View>
  );
}

function MembershipHero({
  tiers,
  plans,
}: Readonly<{ tiers: number; plans: number }>) {
  return (
    <View style={localStyles.proHero}>
      <Text style={localStyles.proLabel}>MEMBERSHIP</Text>
      <Text style={localStyles.proTitle}>按产品动态组合等级</Text>
      <Text style={localStyles.proBody}>
        当前配置包含 {tiers} 个等级与 {plans} 个方案。
      </Text>
    </View>
  );
}

function TierCard({
  tier,
  current,
}: Readonly<{ tier: MembershipTier; current: boolean }>) {
  return (
    <AppCard>
      <View style={localStyles.tierHeading}>
        <Text style={styles.heading}>{tier.name}</Text>
        <Text style={current ? localStyles.currentTag : styles.caption}>
          {current ? "当前等级" : tier.recommended ? "推荐" : ""}
        </Text>
      </View>
      <Text style={styles.secondary}>{tier.summary}</Text>
      <Text style={styles.caption}>
        {tier.entitlements.length} 项已配置权益
      </Text>
    </AppCard>
  );
}

function PlanCard({
  accent,
  plan,
  selected,
  select,
}: Readonly<{
  accent: string;
  plan: BillingPlan;
  selected: boolean;
  select: () => void;
}>) {
  return (
    <AppCard>
      <ListRow
        label={plan.name}
        value={formatPrice(plan)}
        onPress={select}
        icon={selected ? "check" : "crown"}
        iconColor={accent}
      />
      <Text style={styles.caption}>
        {selected ? "已选择此方案" : `支付渠道：${plan.provider}`}
      </Text>
    </AppCard>
  );
}

export function formatPrice(plan: BillingPlan) {
  const price = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: plan.currency,
  }).format(plan.priceMinor / 100);
  const period = { month: "月", year: "年", lifetime: "终身", one_time: "次" }[
    plan.interval
  ];
  return `${price}/${period}`;
}

const localStyles = StyleSheet.create({
  tierHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  currentTag: { color: colors.success, fontSize: 12, fontWeight: "700" },
  proHero: {
    borderRadius: radii.card,
    padding: spacing.x6,
    gap: spacing.x3,
    backgroundColor: colors.text,
  },
  proLabel: { color: colors.brand, fontWeight: "700", letterSpacing: 2 },
  proTitle: { color: colors.surface, fontSize: 26, fontWeight: "700" },
  proBody: { color: colors.border, fontSize: 14 },
});
