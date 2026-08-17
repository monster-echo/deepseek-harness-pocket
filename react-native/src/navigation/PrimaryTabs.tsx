import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { usePreferences } from '../preferences/PreferencesProvider';
import { useApp } from '../state/AppStore';
import { spacing } from '../theme/tokens';

type PrimaryTab = 'home' | 'profile';

// 悬浮胶囊 tab bar：圆角卡片 + 阴影 + 与屏幕边缘留白，仍占文档流（两屏内容区无需改 padding）。
// 选中项用 brandSoft 药丸背景高亮，观感更现代。
export function PrimaryTabs({ active }: Readonly<{ active: PrimaryTab }>) {
  const { replace } = useApp();
  const { locale, palette } = usePreferences();
  const labels = locale === 'en-US'
    ? { home: 'Home', profile: 'Profile' }
    : { home: '首页', profile: '我的' };
  return (
    <View style={tabStyles.dock}>
      <View style={[tabStyles.bar, { backgroundColor: palette.surface }]}>
        <Tab active={active === 'home'} icon="home" label={labels.home} onPress={() => replace('home')} />
        <Tab active={active === 'profile'} icon="user" label={labels.profile} onPress={() => replace('profile.home')} />
      </View>
    </View>
  );
}

function Tab({ active, icon, label, onPress }: Readonly<{
  active: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
}>) {
  const { palette } = usePreferences();
  const color = active ? palette.brand : palette.textSecondary;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[tabStyles.item, active && { backgroundColor: palette.brandSoft }]}
    >
      <AppIcon name={icon} color={color} size={22} />
      <Text style={[tabStyles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const tabStyles = StyleSheet.create({
  dock: {
    // 与屏幕左右下留白，给阴影和悬浮感让出空间
    paddingHorizontal: spacing.x4,
    paddingBottom: spacing.x3,
  },
  bar: {
    height: 60,
    flexDirection: 'row',
    borderRadius: 24,
    gap: spacing.x1,
    paddingHorizontal: spacing.x2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 8 },
    }),
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x1,
    paddingVertical: spacing.x1,
    borderRadius: 18,
  },
  label: { fontSize: 12, fontWeight: '600' },
});
