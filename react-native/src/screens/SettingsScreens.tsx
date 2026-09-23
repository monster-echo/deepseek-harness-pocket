import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Check, ChevronRight, Crown, Lock, Settings as SettingsIcon, TriangleAlert } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { Sheet } from '../design-system/Sheet';
import { SessionView } from '../domain/models';
import { AppRoute } from '../navigation/routes';
import { TranslationKey, usePreferences } from '../preferences/PreferencesProvider';
import { useApp } from '../state/AppStore';
import type { AgentPresetInfo } from '@deepseek-harness-pocket/bridge-protocol';
import { useDshStore } from '../state/dshStore';
import { telemetry } from '../telemetry/Telemetry';

type SettingItem = Readonly<{
  policy?: string;
  label: TranslationKey;
  route: AppRoute;
  value?: string;
}>;
type SettingGroup = Readonly<{ title: TranslationKey; items: readonly SettingItem[] }>;

const groups: readonly SettingGroup[] = [
  { title: 'accountServices', items: [
    { label: 'accountSecurity', route: 'settings.accountSecurity' },
    { label: 'devices', route: 'settings.devices' },
    { label: 'membership', route: 'membership.home' },
  ] },
  { title: 'appPreferences', items: [
    { policy: 'notifications', label: 'notifications', route: 'settings.notifications' },
    { policy: 'general', label: 'general', route: 'settings.general' },
    { policy: 'appearance', label: 'appearance', route: 'settings.appearance' },
    { policy: 'language', label: 'language', route: 'settings.language' },
    { policy: 'appearance', label: 'textSize', route: 'settings.textSize' },
  ] },
  { title: 'privacySupport', items: [
    { policy: 'analytics', label: 'privacy', route: 'settings.privacy' },
    { label: 'permissions', route: 'settings.permissions' },
    { label: 'storage', route: 'settings.storage' },
    { label: 'help', route: 'settings.helpFeedback' },
    { label: 'legal', route: 'settings.legal' },
    { label: 'about', route: 'settings.about', value: '1.0.0' },
    { policy: 'accountDeletion', label: 'deleteAccount', route: 'settings.deleteAccount' },
  ] },
];

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

/** 离线提示条（原 design-system OfflineBanner 的就地 RNR 版）。 */
function OfflineBanner() {
  const { online, refreshBootstrap } = useApp();
  if (online) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="bg-muted min-h-10 flex-row items-center justify-center gap-2 px-4"
      onPress={() => void refreshBootstrap()}
    >
      <Icon as={TriangleAlert} className="size-[18px]" />
      <Text className="text-xs font-semibold">当前离线，正在使用本地配置 · 点击重试</Text>
    </Pressable>
  );
}

export function SettingsScreen() {
  const { config, user, navigate } = useApp();
  const { text } = usePreferences();
  const [modelSheet, setModelSheet] = useState(false);
  const [presetSheet, setPresetSheet] = useState(false);
  const [pluginSheet, setPluginSheet] = useState(false);
  const queueSend = useDshStore((s) => s.queueSend);
  const setQueueSend = useDshStore((s) => s.setQueueSend);
  const visible = (item: SettingItem) => !item.policy
    || config.settingsPolicy[item.policy]?.visibility === 'visible';
  return (
    <View className="bg-background flex-1">
      <OfflineBanner />
      <ScreenHeader title={text('settings')} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <Text className="text-xl font-bold">{user?.displayName ?? text('guest')}</Text>
            <Text className="text-muted-foreground text-sm">
              {user ? (user.hasEmail && user.email ? user.email : '未绑定邮箱') : text('signInSync')}
            </Text>
          </CardContent>
        </Card>
        {/* Agent 设置（dsh worker 级：模型 / Agent 预设） */}
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wider">Agent</Text>
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <Pressable className="flex-row items-center gap-3 py-3" onPress={() => setModelSheet(true)}>
              <Icon as={SettingsIcon} className="text-muted-foreground size-4" />
              <Text className="flex-1 text-[15px]">模型</Text>
              <Icon as={ChevronRight} className="text-muted-foreground size-4" />
            </Pressable>
            <Pressable className="flex-row items-center gap-3 py-3" onPress={() => setPresetSheet(true)}>
              <Icon as={Crown} className="text-muted-foreground size-4" />
              <Text className="flex-1 text-[15px]">Agent 预设</Text>
              <Icon as={ChevronRight} className="text-muted-foreground size-4" />
            </Pressable>
            <Pressable className="flex-row items-center gap-3 py-3" onPress={() => setPluginSheet(true)}>
              <Icon as={SettingsIcon} className="text-muted-foreground size-4" />
              <Text className="flex-1 text-[15px]">插件</Text>
              <Icon as={ChevronRight} className="text-muted-foreground size-4" />
            </Pressable>
            <Pressable className="flex-row items-center gap-3 py-3" onPress={() => navigate("settings.workerConfig")}>
              <Icon as={SettingsIcon} className="text-muted-foreground size-4" />
              <Text className="flex-1 text-[15px]">Worker 配置（只读）</Text>
              <Icon as={ChevronRight} className="text-muted-foreground size-4" />
            </Pressable>
            <View className="min-h-[54px] flex-row items-center gap-3 px-4">
              <Text className="flex-1 text-base">排队发送</Text>
              <Switch checked={queueSend} onCheckedChange={setQueueSend} />
            </View>
          </CardContent>
        </Card>
        {groups.map((group) => (
          <View key={group.title}>
            <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wider">
              {text(group.title)}
            </Text>
            <Card className="gap-0 py-0">
              <CardContent className="gap-3 py-4">
                {group.items.filter(visible).map((item) => {
                  const value = settingValue(item, user?.settings, text);
                  return (
                    <Pressable
                      key={item.route}
                      className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
                      onPress={() => {
                        telemetry.track('ui_action', { action_id: item.route });
                        navigate(item.route);
                      }}
                    >
                      <Text className="flex-1 text-base">{text(item.label)}</Text>
                      {value ? <Text className="text-muted-foreground text-sm">{value}</Text> : null}
                      <Icon as={ChevronRight} className="text-muted-foreground size-[18px]" />
                    </Pressable>
                  );
                })}
              </CardContent>
            </Card>
          </View>
        ))}
      </ScrollView>
      <ModelSheet visible={modelSheet} onClose={() => setModelSheet(false)} />
      <PresetSheet visible={presetSheet} onClose={() => setPresetSheet(false)} />
      <PluginSheet visible={pluginSheet} onClose={() => setPluginSheet(false)} />
    </View>
  );
}

function PluginSheet({ visible, onClose }: Readonly<{ visible: boolean; onClose: () => void }>) {
  const [plugins, setPlugins] = useState<readonly { id: string; name: string; enabled: boolean }[]>([]);
  const listPlugins = useDshStore((s) => s.listPlugins);
  useEffect(() => {
    if (!visible) return
    void listPlugins().then(setPlugins)
  }, [visible, listPlugins])
  return (
    <Sheet visible={visible} title={`插件（${plugins.length}）`} onClose={onClose} scrollable snapPoints={['55%', '85%']}>
      {plugins.map((p) => (
        <View key={p.id} className="border-border mb-2 flex-row items-center gap-2 rounded-xl border p-3">
          <View className="flex-1">
            <Text className="text-sm font-semibold">{p.name}</Text>
          </View>
          <Text className={`text-[11px] ${p.enabled ? 'text-success' : 'text-muted-foreground'}`}>
            {p.enabled ? '已启用' : '已停用'}
          </Text>
        </View>
      ))}
      {plugins.length === 0 && <Text className="text-muted-foreground p-2 text-xs">插件列表为空（需活跃 worker）</Text>}
    </Sheet>
  )
}

function ModelSheet({ visible, onClose }: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { showToast } = useApp();
  const [models, setModels] = useState<readonly { id: string; name?: string }[]>([]);
  const listModels = useDshStore((s) => s.listModels);
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults);
  const current = useDshStore((s) => s.newSessionDefaults);
  useEffect(() => {
    if (!visible) return
    void listModels().then((r) => setModels(r.providers[0]?.models ?? []))
  }, [visible, listModels])
  return (
    <Sheet visible={visible} title="模型（新会话默认）" onClose={onClose} scrollable snapPoints={['55%', '85%']}>
      {models.map((m) => {
        const selected = (current?.model ?? 'deepseek-v4-flash') === m.id
        return (
          <Pressable
            key={m.id}
            className={`mb-2 flex-row items-center gap-2 rounded-xl border p-3 ${selected ? 'border-primary' : 'border-border'}`}
            onPress={() => { setDefaults({ provider: 'deepseek-official', model: m.id }); showToast(`默认模型 ${m.id}`, 'info'); onClose(); }}
          >
            <View className="flex-1">
              <Text className="font-mono text-sm font-semibold">{m.id}</Text>
              {m.name !== undefined && m.name.length > 0 && <Text className="text-muted-foreground mt-0.5 text-[11px]">{m.name}</Text>}
            </View>
            {selected && <Icon as={Check} className="text-primary size-4" />}
          </Pressable>
        )
      })}
      {models.length === 0 && <Text className="text-muted-foreground p-2 text-xs">目录为空（需活跃 worker）</Text>}
    </Sheet>
  )
}

function PresetSheet({ visible, onClose }: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { showToast } = useApp();
  const [presets, setPresets] = useState<readonly AgentPresetInfo[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const listPresets = useDshStore((s) => s.listPresets);
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults);
  const current = useDshStore((s) => s.newSessionPreset);
  useEffect(() => {
    if (!visible) return
    void listPresets().then(setPresets)
  }, [visible, listPresets])
  return (
    <Sheet visible={visible} title="Agent 预设（新会话默认）" onClose={onClose} scrollable snapPoints={['55%', '85%']}>
      {presets.map((p) => {
        const selected = (current.length > 0 ? current : 'standard') === p.id
        return (
          <Pressable
            key={p.id}
            className={`mb-2 flex-row items-center gap-2 rounded-xl border p-3 ${selected ? 'border-primary' : 'border-border'}`}
            onPress={() => { setDefaults(null, p.id); showToast(`默认模式 ${p.name ?? p.id}`, 'info'); onClose(); }}
          >
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-semibold">{p.name ?? p.id}{p.isDefault ? '（默认）' : ''}</Text>
                <Badge variant="secondary">
                  <Text>{p.trust === 'user' ? '自定义' : '内置'}</Text>
                </Badge>
              </View>
              {p.description !== undefined && <Text className="text-muted-foreground mt-0.5 text-[11px]" numberOfLines={2}>{p.description}</Text>}
              {p.broken !== undefined && (
                <Text className="text-destructive mt-0.5 text-[11px]">无法使用：{p.broken}</Text>
              )}
              {p.composition !== undefined && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={expanded === p.id ? '收起组成' : '查看组成'}
                  hitSlop={6}
                  className="mt-1 self-start"
                  onPress={() => setExpanded(expanded === p.id ? null : p.id)}
                >
                  <Text className="text-primary text-[11px]">
                    {expanded === p.id ? '收起组成' : '查看组成'}
                  </Text>
                </Pressable>
              )}
              {expanded === p.id && p.composition !== undefined && (
                <Text className="text-muted-foreground mt-1 font-mono text-[10.5px] leading-[15px]">
                  {p.composition}
                </Text>
              )}
            </View>
            {selected && <Icon as={Check} className="text-primary size-4" />}
          </Pressable>
        )
      })}
      {presets.length === 0 && <Text className="text-muted-foreground p-2 text-xs">preset 目录为空（需活跃 worker）</Text>}
    </Sheet>
  )
}

function settingValue(
  item: SettingItem,
  settings: Readonly<Record<string, unknown>> | undefined,
  text: (key: TranslationKey) => string,
) {
  if (item.value) return item.value;
  if (item.route === 'settings.appearance') {
    return { system: text('system'), light: text('light'), dark: text('dark') }[
      String(settings?.theme ?? 'system')
    ];
  }
  if (item.route === 'settings.language') {
    return settings?.language === 'en-US' ? text('english') : text('chinese');
  }
  return undefined;
}

export function AccountSecurityScreen() {
  const { user, changePassword, busy, navigate, showToast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const submit = async () => {
    if (await changePassword(current, next)) {
      showToast('密码已修改，请重新登录', 'success');
      navigate('auth.signIn');
    }
  };
  const submitLabel = busy ? '修改中…' : '修改密码';
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="账户与安全" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">登录邮箱</Text>
              <Text className="text-muted-foreground text-sm">
                {user ? (user.hasEmail && user.email ? user.email : '未绑定邮箱') : '未登录'}
              </Text>
            </View>
            <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
              <Text className="flex-1 text-base">身份绑定</Text>
              <Text className="text-muted-foreground text-sm">邮箱密码</Text>
            </View>
          </CardContent>
        </Card>
        <Input
          accessibilityLabel="当前密码"
          className="min-h-[52px]"
          onChangeText={setCurrent}
          placeholder="当前密码"
          secureTextEntry
          value={current}
        />
        <Input
          accessibilityLabel="新密码"
          className="min-h-[52px]"
          onChangeText={setNext}
          placeholder="至少 8 位新密码"
          secureTextEntry
          value={next}
        />
        <Button
          className="min-h-[52px] w-full"
          disabled={busy || !user}
          onPress={() => {
            telemetry.track('ui_action', { action_id: `button.${submitLabel}` });
            void submit();
          }}
        >
          <Icon as={Lock} className="size-5" />
          <Text>{submitLabel}</Text>
        </Button>
      </ScrollView>
    </View>
  );
}

export function DevicesScreen() {
  const { loadSessions, revokeSession, user } = useApp();
  const [sessions, setSessions] = useState<readonly SessionView[]>([]);
  useEffect(() => {
    if (user) void loadSessions().then(setSessions);
  }, [loadSessions, user]);
  const revoke = async (id: string) => {
    if (await revokeSession(id)) setSessions((items) => items.filter((item) => item.id !== id));
  };
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="登录设备" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        {sessions.map((session) => (
          <Card key={session.id} className="gap-0 py-0">
            <CardContent className="gap-3 py-4">
              {session.current ? (
                <View className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4">
                  <Text className="flex-1 text-base">{session.deviceName}</Text>
                  <Text className="text-muted-foreground text-sm">当前设备</Text>
                </View>
              ) : (
                <Pressable
                  className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
                  onPress={() => {
                    telemetry.track('ui_action', { action_id: `row.${session.deviceName}` });
                    void revoke(session.id);
                  }}
                >
                  <Text className="flex-1 text-base">{session.deviceName}</Text>
                  <Text className="text-muted-foreground text-sm">撤销</Text>
                  <Icon as={ChevronRight} className="text-muted-foreground size-[18px]" />
                </Pressable>
              )}
              <Text className="text-muted-foreground text-xs">最近活动：{formatDate(session.lastSeenAt)}</Text>
            </CardContent>
          </Card>
        ))}
        {!sessions.length ? <Text className="text-muted-foreground text-sm">暂无活动会话。</Text> : null}
      </ScrollView>
    </View>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}
