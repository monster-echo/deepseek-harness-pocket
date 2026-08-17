import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { PrimaryTabs } from '../navigation/PrimaryTabs';
import { AppCard, IconButton, OfflineBanner } from '../design-system/components';
import { AppRoute } from '../navigation/routes';
import { useApp } from '../state/AppStore';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

const quickActions: ReadonlyArray<Readonly<{
  label: string;
  icon: IconName;
  route: AppRoute;
  feature?: string;
}>> = [
  { label: '会员', icon: 'crown', route: 'membership.home', feature: 'membership' },
  { label: '优惠券', icon: 'gift', route: 'profile.coupons', feature: 'coupons' },
  { label: '通知', icon: 'bell', route: 'notifications.center', feature: 'notifications' },
  { label: '设置', icon: 'settings', route: 'settings.home' },
];

export function HomeScreen() {
  const { navigate, config, user } = useApp();
  const { palette } = usePreferences();
  const tier = config.tiers.find((item) => item.id === user?.tierId);
  return (
    <View style={styles.page}>
      <OfflineBanner />
      <View style={homeStyles.header}>
        <View>
          <Text style={styles.secondary}>下午好</Text>
          <Text style={styles.heading}>
            {user ? `${user.displayName}，欢迎回来` : `欢迎使用 ${config.brand.appName}`}
          </Text>
        </View>
        <IconButton label="通知中心" icon="bell" onPress={() => navigate('notifications.center')} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Pressable onPress={() => navigate('membership.home')} style={homeStyles.banner}>
          <View style={homeStyles.bannerCopy}>
            <Text style={homeStyles.bannerTitle}>{tier?.name ?? 'Free'} 创作空间</Text>
            <Text style={homeStyles.bannerText}>
              {tier?.summary ?? '查看可配置的会员等级与权益'}
            </Text>
          </View>
          <AppIcon name="gift" color={colors.surface} size={42} />
        </Pressable>
        <View style={homeStyles.quickGrid}>
          {quickActions.filter((item) => !item.feature || config.features[item.feature]).map((item) => (
            <Pressable
              key={item.route}
              onPress={() => navigate(item.route)}
              style={homeStyles.quickItem}
            >
              <View style={[homeStyles.quickIcon, { backgroundColor: palette.brandSoft }]}>
                <AppIcon name={item.icon} color={colors.brand} />
              </View>
              <Text style={styles.body}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionLabel}>最近动态</Text>
        <AppCard>
          <Text style={styles.heading}>模板已准备完成</Text>
          <Text style={styles.secondary}>三端共享页面、状态、路由与设计令牌。</Text>
        </AppCard>
        <AppCard>
          <Text style={styles.heading}>检查全部状态</Text>
          <Text style={styles.secondary}>预览加载、空数据、错误、离线和未授权状态。</Text>
          <Pressable onPress={() => navigate('states.gallery')} style={homeStyles.textAction}>
            <Text style={homeStyles.textActionLabel}>打开状态库</Text>
            <AppIcon name="chevron-right" color={colors.brand} size={18} />
          </Pressable>
        </AppCard>
      </ScrollView>
      <PrimaryTabs active="home" />
    </View>
  );
}

const homeStyles = StyleSheet.create({
  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.x4,
  },
  banner: {
    minHeight: 132,
    borderRadius: radii.card,
    padding: spacing.x5,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerCopy: { flex: 1, gap: spacing.x2 },
  bannerTitle: { color: colors.surface, fontSize: 22, fontWeight: '700' },
  bannerText: { color: colors.surface, fontSize: 14, opacity: 0.82 },
  quickGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  quickItem: { alignItems: 'center', gap: spacing.x2 },
  quickIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    backgroundColor: colors.brandSoft,
  },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.x1 },
  textActionLabel: { color: colors.brand, fontWeight: '700' },
});
