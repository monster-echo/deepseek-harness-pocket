/**
 * 我的电脑（Worker 管理）：worker 列表（可选/切换）+ 右上角「+」添加（配对）。
 * 侧边栏点「选择电脑」进入本页，选择后返回；「+」进入安装指引 + 配对码表单。
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
  { title: '1. 安装（电脑端，需 Node.js）', command: 'npm i -g @deepseek-harness-pocket/bridge' },
  { title: '2. 启动并守护 dsh', command: 'dshc start' },
  { title: '3. 开机自启（推荐）', command: 'dshc install' },
]

export function PairWorkerScreen() {
  const { palette } = usePreferences();
  const { back } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const openWorker = useDshStore((s) => s.openWorker);

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable onPress={() => back()} hitSlop={12}>
          <AppIcon name="arrow-left" color={palette.text} size={22} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>我的电脑</Text>
        {/* 右上角 +：进入添加/配对 */}
        <Pressable onPress={() => setShowAdd(true)} hitSlop={12}>
          <AppIcon name="plus" color={palette.brand} size={22} />
        </Pressable>
      </View>

      {showAdd ? (
        <AddWorkerForm onDone={() => setShowAdd(false)} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {workers.length === 0 && (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
                还没有电脑。点右上角「+」安装并配对一台电脑。
              </Text>
            </View>
          )}
          {workers.map((worker) => {
            const active = worker.workerId === activeWorkerId
            return (
              <Pressable
                key={worker.workerId}
                style={[styles.workerRow, { borderColor: palette.border, backgroundColor: palette.surface }, active && { borderColor: palette.brand, backgroundColor: palette.brandSoft }]}
                onPress={() => { openWorker(worker.workerId); back(); }}
              >
                <View style={[styles.dot, { backgroundColor: worker.online ? palette.success : palette.textSecondary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.workerName, { color: palette.text }]} numberOfLines={1}>{worker.name}</Text>
                  <Text style={[styles.workerStatus, { color: palette.textSecondary }]}>{worker.online ? '在线' : '离线'}</Text>
                </View>
                {active && <AppIcon name="check" color={palette.brand} size={18} />}
              </Pressable>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}

function AddWorkerForm({ onDone }: Readonly<{ onDone: () => void }>) {
  const { palette } = usePreferences();
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
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {INSTALL_STEPS.map((step) => (
        <View key={step.command} style={[styles.step, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <Text style={[styles.stepTitle, { color: palette.text }]}>{step.title}</Text>
          <Text style={[styles.stepCommand, { color: palette.brand }]} selectable>{step.command}</Text>
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
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.x3, paddingTop: spacing.x6, paddingBottom: spacing.x2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17 },
  body: { padding: spacing.x4, gap: spacing.x3 },
  empty: { alignItems: 'center', paddingVertical: spacing.x8 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  workerName: { fontSize: 15, fontWeight: '600' },
  workerStatus: { fontSize: 12, marginTop: 2 },
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
