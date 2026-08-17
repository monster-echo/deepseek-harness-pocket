/**
 * 配对电脑：安装指引（平台命令）+ 6 位配对码手输（扫码 M2 接入 expo-camera）。
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import { bindWorkerByCode } from '../../dsh/connection';
import { spacing, radii } from '../../theme/tokens';

const INSTALL_STEPS: readonly { title: string; command: string }[] = [
  { title: '1. 安装（电脑端，需 Node.js）', command: 'npm i -g @dsh-companion/bridge' },
  { title: '2. 启动并守护 dsh', command: 'dshc start' },
  { title: '3. 开机自启（推荐）', command: 'dshc install' },
]

export function PairWorkerScreen() {
  const { palette } = usePreferences();
  const { replace } = useApp();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectGateway = useDshStore((s) => s.connectGateway);

  const bind = async (): Promise<void> => {
    if (!/^\d{6}$/.test(code)) {
      setError('请输入电脑终端显示的 6 位配对码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await bindWorkerByCode(code, name.trim().length > 0 ? name.trim() : undefined)
      connectGateway()
      replace('home')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable onPress={() => replace('home')} hitSlop={12}>
          <AppIcon name="arrow-left" color={palette.text} size={22} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>配对电脑</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {INSTALL_STEPS.map((step) => (
          <View key={step.command} style={[styles.step, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.stepTitle, { color: palette.text }]}>{step.title}</Text>
            <Text style={[styles.stepCommand, { color: palette.brand }]} selectable>
              {step.command}
            </Text>
          </View>
        ))}
        <Text style={[styles.hint, { color: palette.textSecondary }]}>
          电脑终端会打印二维码与 6 位配对码；此处先手输配对码完成绑定（扫码即将上线）。
        </Text>

        <View style={[styles.formCard, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <TextInput
            style={[styles.codeInput, { color: palette.text, borderColor: palette.border }]}
            placeholder="6 位配对码"
            placeholderTextColor={palette.textSecondary}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          <TextInput
            style={[styles.nameInput, { color: palette.text, borderColor: palette.border }]}
            placeholder="给这台电脑起个名字（可选）"
            placeholderTextColor={palette.textSecondary}
            value={name}
            onChangeText={setName}
          />
          {error !== null && <Text style={[styles.error, { color: palette.error }]}>{error}</Text>}
          <Pressable
            style={[styles.bindButton, { backgroundColor: busy ? palette.surfaceMuted : palette.brand }]}
            disabled={busy}
            onPress={() => void bind()}
          >
            <Text style={styles.bindText}>{busy ? '绑定中…' : '绑定到我的账号'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.x3,
    paddingHorizontal: spacing.x3, paddingTop: spacing.x6, paddingBottom: spacing.x2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17 },
  body: { padding: spacing.x4, gap: spacing.x3 },
  step: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x3, gap: spacing.x2 },
  stepTitle: { fontSize: 14 },
  stepCommand: { fontSize: 13, fontFamily: 'Menlo' },
  hint: { fontSize: 13, lineHeight: 20 },
  formCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x3, gap: spacing.x2, marginTop: spacing.x2 },
  codeInput: { borderWidth: 1, borderRadius: radii.control, padding: spacing.x3, fontSize: 22, letterSpacing: 8, textAlign: 'center' },
  nameInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x2, fontSize: 14 },
  error: { fontSize: 13 },
  bindButton: { borderRadius: radii.round, paddingVertical: spacing.x3, alignItems: 'center' },
  bindText: { color: '#FFFFFF', fontSize: 15 },
});
