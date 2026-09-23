import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Check, ChevronRight, Trash } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { usePreferences } from '../preferences/PreferencesProvider';
import { useApp } from '../state/AppStore';
import { telemetry } from '../telemetry/Telemetry';

export type PreferenceKind = 'notifications' | 'general' | 'privacy' | 'appearance' | 'language';

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

export function PreferenceScreen({ kind, title }: Readonly<{
  kind: PreferenceKind;
  title: string;
}>) {
  const { user, saveSettings, busy, showToast } = useApp();
  const { text } = usePreferences();
  const initial = preferenceInitial(kind, user?.settings);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [option, setOption] = useState(initial.option);
  const save = async () => {
    if (await saveSettings(preferencePatch(kind, enabled, option))) {
      showToast(text('saved'), 'success');
    }
  };
  const pageTitle = kind === 'appearance' ? text('appearance')
    : kind === 'language' ? text('language') : title;
  const saveLabel = busy ? text('saving') : text('save');
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title={pageTitle} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <PreferenceFields
              enabled={enabled}
              kind={kind}
              option={option}
              setEnabled={setEnabled}
              setOption={setOption}
            />
          </CardContent>
        </Card>
        <Button
          className="min-h-[52px] w-full"
          disabled={busy || !user}
          onPress={() => {
            telemetry.track('ui_action', { action_id: `button.${saveLabel}` });
            void save();
          }}
        >
          <Icon as={Check} className="size-5" />
          <Text>{saveLabel}</Text>
        </Button>
      </ScrollView>
    </View>
  );
}

function PreferenceFields({ enabled, kind, option, setEnabled, setOption }: Readonly<{
  enabled: boolean;
  kind: PreferenceKind;
  option: string;
  setEnabled: (value: boolean) => void;
  setOption: (value: string) => void;
}>) {
  const { text } = usePreferences();
  if (kind === 'appearance') return <>
    {(['system', 'light', 'dark'] as const).map((value) => (
      <Pressable
        key={value}
        className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
        onPress={() => {
          telemetry.track('ui_action', { action_id: `row.${text(value)}` });
          setOption(value);
        }}
      >
        <Text className="flex-1 text-base">{text(value)}</Text>
        {option === value ? <Text className="text-muted-foreground text-sm">{text('selected')}</Text> : null}
        <Icon as={ChevronRight} className="text-muted-foreground size-[18px]" />
      </Pressable>
    ))}
  </>;
  if (kind === 'language') return <>
    <Pressable
      className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
      onPress={() => {
        telemetry.track('ui_action', { action_id: `row.${text('chinese')}` });
        setOption('zh-CN');
      }}
    >
      <Text className="flex-1 text-base">{text('chinese')}</Text>
      {option === 'zh-CN' ? <Text className="text-muted-foreground text-sm">{text('selected')}</Text> : null}
      <Icon as={ChevronRight} className="text-muted-foreground size-[18px]" />
    </Pressable>
    <Pressable
      className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
      onPress={() => {
        telemetry.track('ui_action', { action_id: `row.${text('english')}` });
        setOption('en-US');
      }}
    >
      <Text className="flex-1 text-base">{text('english')}</Text>
      {option === 'en-US' ? <Text className="text-muted-foreground text-sm">{text('selected')}</Text> : null}
      <Icon as={ChevronRight} className="text-muted-foreground size-[18px]" />
    </Pressable>
  </>;
  return (
    <View className="min-h-[54px] flex-row items-center gap-3 px-4">
      <Text className="flex-1 text-base">{preferenceLabel(kind)}</Text>
      <Switch checked={enabled} onCheckedChange={setEnabled} />
    </View>
  );
}

function preferenceInitial(kind: PreferenceKind, settings?: Readonly<Record<string, unknown>>) {
  if (kind === 'appearance') return { enabled: true, option: String(settings?.theme ?? 'system') };
  if (kind === 'language') return { enabled: true, option: String(settings?.language ?? 'zh-CN') };
  const key = kind === 'notifications' ? 'notificationsEnabled'
    : kind === 'privacy' ? 'analyticsEnabled' : 'autoplayEnabled';
  return { enabled: settings?.[key] !== false, option: '' };
}

function preferencePatch(
  kind: PreferenceKind,
  enabled: boolean,
  option: string,
): Readonly<Record<string, string | number | boolean>> {
  if (kind === 'appearance') return { theme: option };
  if (kind === 'language') return { language: option };
  if (kind === 'notifications') return { notificationsEnabled: enabled };
  if (kind === 'privacy') return { analyticsEnabled: enabled };
  return { autoplayEnabled: enabled };
}

function preferenceLabel(kind: PreferenceKind) {
  if (kind === 'notifications') return '允许应用内通知';
  if (kind === 'privacy') return '允许匿名使用分析';
  return '自动播放推荐内容';
}

export function DeleteAccountScreen() {
  const { deleteAccount, busy, replace, showConfirm } = useApp();
  const [password, setPassword] = useState('');
  const requestDeletion = () => showConfirm({
    title: '永久删除账户？',
    message: '服务端将删除账户、会话、通知和订单关联，操作无法恢复。',
    confirmLabel: '永久删除',
    onConfirm: async () => { if (await deleteAccount(password)) replace('home'); },
  });
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="注销账户" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Text className="text-muted-foreground text-sm">请输入当前密码完成重新认证。</Text>
        <Input
          accessibilityLabel="当前密码"
          className="min-h-[52px]"
          onChangeText={setPassword}
          placeholder="当前密码"
          secureTextEntry
          value={password}
        />
        <Button
          className="min-h-[52px] w-full"
          disabled={busy || !password}
          onPress={() => {
            telemetry.track('ui_action', { action_id: 'button.永久删除账户' });
            requestDeletion();
          }}
          variant="destructive"
        >
          <Icon as={Trash} className="size-5" />
          <Text>永久删除账户</Text>
        </Button>
      </ScrollView>
    </View>
  );
}
