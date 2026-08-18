import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  AppButton, AppCard, ListRow, OfflineBanner, PageHeader, ToggleRow,
} from '../design-system/components';
import { AppIcon } from '../design-system/AppIcon';
import { Sheet } from '../design-system/Sheet';
import { SessionView } from '../domain/models';
import { AppRoute } from '../navigation/routes';
import { TranslationKey, usePreferences } from '../preferences/PreferencesProvider';
import { useApp } from '../state/AppStore';
import { useDshStore } from '../state/dshStore';
import { radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

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

export function SettingsScreen() {
  const { config, user } = useApp();
  const { text, palette } = usePreferences();
  const [modelSheet, setModelSheet] = useState(false);
  const [presetSheet, setPresetSheet] = useState(false);
  const queueSend = useDshStore((s) => s.queueSend);
  const setQueueSend = useDshStore((s) => s.setQueueSend);
  const visible = (item: SettingItem) => !item.policy
    || config.settingsPolicy[item.policy]?.visibility === 'visible';
  return (
    <View style={styles.page}>
      <OfflineBanner />
      <PageHeader title={text('settings')} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <Text style={styles.heading}>{user?.displayName ?? text('guest')}</Text>
          <Text style={styles.secondary}>
            {user ? (user.hasEmail && user.email ? user.email : '未绑定邮箱') : text('signInSync')}
          </Text>
        </AppCard>
        {/* Agent 设置（dsh worker 级：模型 / Agent 预设） */}
        <Text style={styles.sectionLabel}>Agent</Text>
        <AppCard>
          <Pressable style={agentStyles.row} onPress={() => setModelSheet(true)}>
            <AppIcon name="settings" color={palette.textSecondary} size={16} />
            <Text style={[agentStyles.rowLabel, { color: palette.text }]}>模型</Text>
            <AppIcon name="chevron-right" color={palette.textSecondary} size={16} />
          </Pressable>
          <Pressable style={agentStyles.row} onPress={() => setPresetSheet(true)}>
            <AppIcon name="crown" color={palette.textSecondary} size={16} />
            <Text style={[agentStyles.rowLabel, { color: palette.text }]}>Agent 预设</Text>
            <AppIcon name="chevron-right" color={palette.textSecondary} size={16} />
          </Pressable>
          <ToggleRow label="排队发送" value={queueSend} onChange={setQueueSend} />
        </AppCard>
        {groups.map((group) => (
          <View key={group.title}>
            <Text style={styles.sectionLabel}>{text(group.title)}</Text>
            <AppCard>{group.items.filter(visible).map((item) => (
              <ListRow
                key={item.route}
                label={text(item.label)}
                route={item.route}
                value={settingValue(item, user?.settings, text)}
              />
            ))}</AppCard>
          </View>
        ))}
      </ScrollView>
      <ModelSheet visible={modelSheet} onClose={() => setModelSheet(false)} />
      <PresetSheet visible={presetSheet} onClose={() => setPresetSheet(false)} />
    </View>
  );
}

function ModelSheet({ visible, onClose }: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { palette } = usePreferences();
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
          <Pressable key={m.id} style={[agentStyles.option, { borderColor: selected ? palette.brand : palette.border }]} onPress={() => { setDefaults({ provider: 'deepseek-official', model: m.id }); showToast(`默认模型 ${m.id}`, 'info'); onClose(); }}>
            <View style={{ flex: 1 }}>
              <Text style={[agentStyles.optionText, { color: palette.text, fontFamily: 'Menlo' }]}>{m.id}</Text>
              {m.name !== undefined && m.name.length > 0 && <Text style={[agentStyles.optionSub, { color: palette.textSecondary }]}>{m.name}</Text>}
            </View>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        )
      })}
      {models.length === 0 && <Text style={[agentStyles.hint, { color: palette.textSecondary }]}>目录为空（需活跃 worker）</Text>}
    </Sheet>
  )
}

function PresetSheet({ visible, onClose }: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { palette } = usePreferences();
  const { showToast } = useApp();
  const [presets, setPresets] = useState<readonly { id: string; name?: string; description?: string; isDefault: boolean }[]>([]);
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
          <Pressable key={p.id} style={[agentStyles.option, { borderColor: selected ? palette.brand : palette.border }]} onPress={() => { setDefaults(null, p.id); showToast(`默认模式 ${p.name ?? p.id}`, 'info'); onClose(); }}>
            <View style={{ flex: 1 }}>
              <Text style={[agentStyles.optionText, { color: palette.text }]}>{p.name ?? p.id}{p.isDefault ? '（默认）' : ''}</Text>
              {p.description !== undefined && <Text style={[agentStyles.optionSub, { color: palette.textSecondary }]} numberOfLines={2}>{p.description}</Text>}
            </View>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        )
      })}
      {presets.length === 0 && <Text style={[agentStyles.hint, { color: palette.textSecondary }]}>preset 目录为空（需活跃 worker）</Text>}
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
  return (
    <View style={styles.page}>
      <PageHeader title="账户与安全" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <ListRow
            label="登录邮箱"
            value={user ? (user.hasEmail && user.email ? user.email : '未绑定邮箱') : '未登录'}
          />
          <ListRow label="身份绑定" value="邮箱密码" />
        </AppCard>
        <TextInput
          accessibilityLabel="当前密码"
          onChangeText={setCurrent}
          placeholder="当前密码"
          secureTextEntry
          style={styles.input}
          value={current}
        />
        <TextInput
          accessibilityLabel="新密码"
          onChangeText={setNext}
          placeholder="至少 8 位新密码"
          secureTextEntry
          style={styles.input}
          value={next}
        />
        <AppButton
          disabled={busy || !user}
          label={busy ? '修改中…' : '修改密码'}
          icon="lock"
          onPress={() => void submit()}
        />
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
    <View style={styles.page}>
      <PageHeader title="登录设备" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {sessions.map((session) => (
          <AppCard key={session.id}>
            <ListRow
              label={session.deviceName}
              value={session.current ? '当前设备' : '撤销'}
              onPress={session.current ? undefined : () => void revoke(session.id)}
            />
            <Text style={styles.caption}>最近活动：{formatDate(session.lastSeenAt)}</Text>
          </AppCard>
        ))}
        {!sessions.length ? <Text style={styles.secondary}>暂无活动会话。</Text> : null}
      </ScrollView>
    </View>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

const agentStyles = {
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.x3, paddingVertical: spacing.x3 },
  rowLabel: { flex: 1, fontSize: 15 },
  hint: { fontSize: 12, padding: spacing.x2 },
  option: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.x2, borderWidth: 1, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  optionText: { fontSize: 14, fontWeight: '600' as const },
  optionSub: { fontSize: 11, marginTop: 2 },
};
