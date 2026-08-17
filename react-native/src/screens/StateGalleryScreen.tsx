import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../design-system/AppIcon';
import { AppButton, PageHeader } from '../design-system/components';
import { AsyncState } from '../state/asyncState';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

type DemoState = AsyncState<ReadonlyArray<string>>;
const states: ReadonlyArray<DemoState> = [
  { status: 'loading' },
  { status: 'empty' },
  { status: 'error', message: '服务暂时不可用' },
  { status: 'offline' },
  { status: 'unauthorized' },
  { status: 'success', data: ['状态加载成功'] },
];

export function StateGalleryScreen() {
  const [index, setIndex] = useState(0);
  const state = states[index];
  const next = () => setIndex((value) => (value + 1) % states.length);
  return (
    <View style={styles.page}>
      <PageHeader title="状态库" />
      <View style={styles.centered}>
        <StateContent state={state} />
        <View style={stateStyles.fullWidth}>
          <AppButton label="切换状态" onPress={next} />
        </View>
      </View>
    </View>
  );
}

function StateContent({ state }: Readonly<{ state: DemoState }>) {
  const { palette } = usePreferences();
  const config = {
    idle: ['check', '等待操作'],
    loading: ['settings', '正在加载'],
    empty: ['gift', '暂无数据'],
    error: ['alert', state.status === 'error' ? state.message : '发生错误'],
    offline: ['globe', '网络连接已断开'],
    unauthorized: ['lock', '请先登录'],
    success: ['check', '加载成功'],
  } as const;
  const [icon, label] = config[state.status];
  return (
    <View style={stateStyles.content}>
      <View style={[stateStyles.icon, { backgroundColor: palette.brandSoft }]}>
        <AppIcon name={icon} color={palette.brand} size={36} />
      </View>
      <Text style={styles.heading}>{label}</Text>
      <Text style={styles.secondary}>状态互斥，由统一状态机驱动。</Text>
    </View>
  );
}

const stateStyles = StyleSheet.create({
  fullWidth: { width: '100%' },
  content: { alignItems: 'center', gap: spacing.x3 },
  icon: {
    width: 72,
    height: 72,
    borderRadius: radii.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
});
