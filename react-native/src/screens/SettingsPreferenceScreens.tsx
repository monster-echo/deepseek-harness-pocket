import React, { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { AppButton, AppCard, ListRow, PageHeader, ToggleRow } from '../design-system/components';
import { usePreferences } from '../preferences/PreferencesProvider';
import { useApp } from '../state/AppStore';
import { styles } from '../theme/styles';

export type PreferenceKind = 'notifications' | 'general' | 'privacy' | 'appearance' | 'language';

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
  return (
    <View style={styles.page}>
      <PageHeader title={pageTitle} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppCard>
          <PreferenceFields
            enabled={enabled}
            kind={kind}
            option={option}
            setEnabled={setEnabled}
            setOption={setOption}
          />
        </AppCard>
        <AppButton
          disabled={busy || !user}
          label={busy ? text('saving') : text('save')}
          icon="check"
          onPress={() => void save()}
        />
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
      <ListRow
        key={value}
        label={text(value)}
        onPress={() => setOption(value)}
        value={option === value ? text('selected') : ''}
      />
    ))}
  </>;
  if (kind === 'language') return <>
    <ListRow label={text('chinese')} onPress={() => setOption('zh-CN')} value={option === 'zh-CN' ? text('selected') : ''} />
    <ListRow label={text('english')} onPress={() => setOption('en-US')} value={option === 'en-US' ? text('selected') : ''} />
  </>;
  return <ToggleRow label={preferenceLabel(kind)} value={enabled} onChange={setEnabled} />;
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
    <View style={styles.page}>
      <PageHeader title="注销账户" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.secondary}>请输入当前密码完成重新认证。</Text>
        <TextInput
          accessibilityLabel="当前密码"
          onChangeText={setPassword}
          placeholder="当前密码"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <AppButton
          disabled={busy || !password}
          label="永久删除账户"
          icon="trash"
          variant="danger"
          onPress={requestDeletion}
        />
      </ScrollView>
    </View>
  );
}
