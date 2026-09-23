import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Check, Crown } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { BillingPlan, MembershipTier } from '../domain/models';
import { useApp } from '../state/AppStore';
import { telemetry } from '../telemetry/Telemetry';
import type { AppRoute } from '../navigation/routes';

type ActionButtonVariant = 'primary' | 'secondary' | 'danger';

const membershipAccents = ['text-warning', 'text-muted-foreground', 'text-warning'] as const;

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
    <View className="bg-background flex-1">
      <PageHeader title="会员中心" />
      <ScrollView contentContainerClassName="gap-4 p-4">
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
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wide">可订阅方案</Text>
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
                <Text className="text-muted-foreground text-sm">
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
          <Text className="text-muted-foreground text-sm">当前 App 暂未配置可售方案。</Text>
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
    <View className="bg-foreground gap-3 rounded-2xl p-6">
      <Text className="text-primary font-bold tracking-[2px]">MEMBERSHIP</Text>
      <Text className="text-background text-[26px] font-bold">按产品动态组合等级</Text>
      <Text className="text-muted-foreground text-sm">
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
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground text-xl font-bold">{tier.name}</Text>
        <Text className={current ? 'text-xs font-bold text-success' : 'text-muted-foreground text-xs'}>
          {current ? "当前等级" : tier.recommended ? "推荐" : ""}
        </Text>
      </View>
      <Text className="text-muted-foreground text-sm">{tier.summary}</Text>
      <Text className="text-muted-foreground text-xs">
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
      <Pressable
        className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
        onPress={() => {
          telemetry.track('ui_action', { action_id: `row.${plan.name}` });
          select();
        }}
      >
        <Icon as={selected ? Check : Crown} className={`size-5 ${accent}`} />
        <Text className="flex-1 text-base">{plan.name}</Text>
        <Text className="text-muted-foreground text-sm">{formatPrice(plan)}</Text>
        <AppIcon name="chevron-right" size={18} />
      </Pressable>
      <Text className="text-muted-foreground text-xs">
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
