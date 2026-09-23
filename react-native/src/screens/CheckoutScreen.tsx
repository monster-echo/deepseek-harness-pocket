import React from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { useApp } from '../state/AppStore';
import { telemetry } from '../telemetry/Telemetry';
import { formatPrice } from './MembershipScreen';

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
    <View className="bg-background flex-1">
      <PageHeader title="确认订阅" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <AppCard>
          <Text className="text-foreground text-xl font-bold">{plan?.name ?? planId}</Text>
          {plan ? <Text className="text-muted-foreground text-sm">{formatPrice(plan)}</Text> : null}
          {plan?.provider === 'mock' ? <Text className="text-muted-foreground text-xs">演示支付：通过模拟渠道完成。</Text> : null}
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
