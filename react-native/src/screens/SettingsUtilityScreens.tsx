import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useStorageMaintenance, openSystemSettings } from '../settings/useStorageMaintenance';
import { useApp } from '../state/AppStore';
import { telemetry } from '../telemetry/Telemetry';

/** RNR 顶栏：返回键（React Navigation canGoBack）+ 居中标题 + 右侧动作。 */
function ScreenHeader({ title, rightAction }: Readonly<{
  title: string;
  rightAction?: Readonly<{ label: string; onPress: () => void; disabled?: boolean }>;
}>) {
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
            <Icon as={ArrowLeft} className="size-5" />
          </Button>
        ) : null}
      </View>
      <Text className="absolute left-[88px] right-[88px] text-center text-[17px] font-bold">
        {title}
      </Text>
      <View className="w-[88px] items-end">
        {rightAction ? (
          <Button
            accessibilityLabel={rightAction.label}
            disabled={rightAction.disabled}
            onPress={rightAction.onPress}
            size="sm"
            variant="ghost"
          >
            <Text className="text-sm font-bold">{rightAction.label}</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export function TextSizeScreen() {
  const { user, saveSettings, busy } = useApp();
  const [scale, setScale] = useState(Number(user?.settings.textScale ?? 1));
  const options = [
    { value: 0.9, label: '较小' },
    { value: 1, label: '标准' },
    { value: 1.15, label: '较大' },
    { value: 1.3, label: '特大' },
  ] as const;
  const saveLabel = busy ? '保存中…' : '保存字体大小';
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="字体大小" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <Text className="text-base" style={{ fontSize: 16 * scale }}>
              这是当前字体大小的实时预览。
            </Text>
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            {options.map((option) => (
              <Pressable
                key={option.value}
                className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
                onPress={() => {
                  telemetry.track('ui_action', { action_id: `row.${option.label}` });
                  setScale(option.value);
                }}
              >
                <Text className="flex-1 text-base">{option.label}</Text>
                {scale === option.value ? <Text className="text-muted-foreground text-sm">已选择</Text> : null}
                <Icon as={ChevronRight} className="text-muted-foreground size-[18px]" />
              </Pressable>
            ))}
          </CardContent>
        </Card>
        <Button
          className="min-h-[52px] w-full"
          disabled={busy || !user}
          onPress={() => {
            telemetry.track('ui_action', { action_id: `button.${saveLabel}` });
            void saveSettings({ textScale: scale });
          }}
        >
          <Text>{saveLabel}</Text>
        </Button>
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
  const clearLabel = storage.loading ? '处理中…' : '清理可再生成缓存';
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="存储与缓存" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">本地键值数量</Text>
              <Text className="text-muted-foreground text-sm">{String(storage.summary?.keys ?? 0)}</Text>
            </View>
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">本地数据大小</Text>
              <Text className="text-muted-foreground text-sm">{formatBytes(storage.summary?.bytes ?? 0)}</Text>
            </View>
          </CardContent>
        </Card>
        <Text className="text-muted-foreground text-sm">
          清理只移除待上传遥测等可再生成缓存，不会删除登录凭证、个人设置或离线配置。
        </Text>
        <Button
          className="min-h-[52px] w-full"
          disabled={storage.loading}
          onPress={() => {
            telemetry.track('ui_action', { action_id: `button.${clearLabel}` });
            clearCache();
          }}
          variant="outline"
        >
          <Text>{clearLabel}</Text>
        </Button>
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
    <View className="bg-background flex-1">
      <ScreenHeader title="权限管理" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <Text className="text-xl font-bold">系统权限由设备管理</Text>
            <Text className="text-muted-foreground text-sm">
              相机、相册、通知和麦克风权限只在相关功能需要时申请。你可以随时前往系统设置修改。
            </Text>
          </CardContent>
        </Card>
        <Button
          className="min-h-[52px] w-full"
          onPress={() => {
            telemetry.track('ui_action', { action_id: 'button.打开系统设置' });
            void openSettings();
          }}
          variant="outline"
        >
          <Text>打开系统设置</Text>
        </Button>
      </ScrollView>
    </View>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
