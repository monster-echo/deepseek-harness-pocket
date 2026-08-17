import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  AppButton,
  AppCard,
  ListRow,
  PageHeader,
} from '../design-system/components';
import { useStorageMaintenance, openSystemSettings } from '../settings/useStorageMaintenance';
import { useApp } from '../state/AppStore';
import { styles } from '../theme/styles';

export function TextSizeScreen() {
  const { user, saveSettings, busy } = useApp();
  const [scale, setScale] = useState(Number(user?.settings.textScale ?? 1));
  const options = [
    { value: 0.9, label: '较小' },
    { value: 1, label: '标准' },
    { value: 1.15, label: '较大' },
    { value: 1.3, label: '特大' },
  ] as const;
  return (
    <View style={styles.page}>
      <PageHeader title="字体大小" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <Text style={[styles.body, { fontSize: 16 * scale }]}>
            这是当前字体大小的实时预览。
          </Text>
        </AppCard>
        <AppCard>
          {options.map((option) => (
            <ListRow
              key={option.value}
              label={option.label}
              onPress={() => setScale(option.value)}
              value={scale === option.value ? '已选择' : ''}
            />
          ))}
        </AppCard>
        <AppButton
          disabled={busy || !user}
          label={busy ? '保存中…' : '保存字体大小'}
          onPress={() => void saveSettings({ textScale: scale })}
        />
      </ScrollView>
    </View>
  );
}

export function StorageScreen() {
  const storage = useStorageMaintenance();
  const { showConfirm, showToast } = useApp();
  const clearCache = () => showConfirm({
    title: '清理可再生成缓存？',
    message: '将移除待上传遥测等临时数据。登录状态、个人设置和离线配置会保留。',
    confirmLabel: '确认清理',
    onConfirm: async () => {
      try {
        const result = await storage.clear();
        const detail = result.bytesFreed
          ? `，已释放 ${formatBytes(result.bytesFreed)}`
          : '，当前没有需要清理的数据';
        showToast(`缓存清理完成${detail}`, 'success');
      } catch {
        showToast('缓存清理失败，请稍后重试', 'error');
      }
    },
  });
  return (
    <View style={styles.page}>
      <PageHeader title="存储与缓存" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <ListRow label="本地键值数量" value={String(storage.summary?.keys ?? 0)} />
          <ListRow label="本地数据大小" value={formatBytes(storage.summary?.bytes ?? 0)} />
        </AppCard>
        <Text style={styles.secondary}>
          清理只移除待上传遥测等可再生成缓存，不会删除登录凭证、个人设置或离线配置。
        </Text>
        <AppButton
          disabled={storage.loading}
          label={storage.loading ? '处理中…' : '清理可再生成缓存'}
          onPress={clearCache}
          variant="secondary"
        />
      </ScrollView>
    </View>
  );
}

export function PermissionsScreen() {
  const { showToast } = useApp();
  const openSettings = async () => {
    if (!await openSystemSettings()) {
      showToast('Web 端请使用浏览器的网站权限设置', 'info');
    }
  };
  return (
    <View style={styles.page}>
      <PageHeader title="权限管理" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <Text style={styles.heading}>系统权限由设备管理</Text>
          <Text style={styles.secondary}>
            相机、相册、通知和麦克风权限只在相关功能需要时申请。你可以随时前往系统设置修改。
          </Text>
        </AppCard>
        <AppButton
          label="打开系统设置"
          onPress={() => void openSettings()}
          variant="secondary"
        />
      </ScrollView>
    </View>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
