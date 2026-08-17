/**
 * 会话侧边栏：Worker 切换器 + 当前 Worker 会话列表 + 底部入口。
 * 手机默认收起（左上角按钮/遮罩打开）；内容由 HomeShellScreen 控制。
 */

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';

export function SessionSidebar({ onClose }: Readonly<{ onClose: () => void }>) {
  const { palette } = usePreferences();
  const { navigate } = useApp();
  const [newSheet, setNewSheet] = useState(false);
  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const sessions = useDshStore((s) => s.sessions);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const openWorker = useDshStore((s) => s.openWorker);
  const openSession = useDshStore((s) => s.openSession);

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      {/* Worker 切换器 */}
      <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>我的电脑</Text>
      {workers.length === 0 && (
        <Pressable style={styles.addWorker} onPress={() => { onClose(); navigate('dsh.pair'); }}>
          <AppIcon name="plus" color={palette.brand} size={18} />
          <Text style={[styles.addWorkerText, { color: palette.brand }]}>添加电脑（Worker）</Text>
        </Pressable>
      )}
      {workers.map((worker) => (
        <Pressable
          key={worker.workerId}
          style={[styles.workerRow, activeWorkerId === worker.workerId && { backgroundColor: palette.brandSoft }]}
          onPress={() => openWorker(worker.workerId)}
        >
          <View style={[styles.dot, { backgroundColor: worker.online ? palette.success : palette.textSecondary }]} />
          <View style={styles.workerText}>
            <Text style={[styles.workerName, { color: palette.text }]} numberOfLines={1}>
              {worker.name}
            </Text>
            <Text style={[styles.workerStatus, { color: palette.textSecondary }]}>
              {worker.online ? '在线' : '离线'}
            </Text>
          </View>
        </Pressable>
      ))}

      {/* 会话列表 */}
      {activeWorkerId !== null && (
        <>
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionTitle, { color: palette.textSecondary, flex: 1 }]}>会话</Text>
            <Pressable style={styles.newButton} onPress={() => setNewSheet(true)} hitSlop={8}>
              <AppIcon name="plus" color={palette.brand} size={16} />
              <Text style={[styles.newButtonText, { color: palette.brand }]}>新会话</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.sessionList}>
            {sessions.length === 0 && (
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>暂无会话</Text>
            )}
            {sessions.map((session) => (
              <Pressable
                key={session.id}
                style={[styles.sessionRow, activeSessionId === session.id && { backgroundColor: palette.brandSoft }]}
                onPress={() => { openSession(session.id); onClose(); }}
              >
                <Text style={[styles.sessionTitle, { color: palette.text }]} numberOfLines={1}>
                  {session.title}
                </Text>
                {session.agentStatus === 'running' && (
                  <View style={[styles.dot, { backgroundColor: palette.warning }]} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      <NewSessionSheet
        visible={newSheet}
        onClose={() => setNewSheet(false)}
        onCreated={() => { setNewSheet(false); onClose(); }}
      />

      {/* 底部入口 */}
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <SidebarEntry icon="user" label="我的" onPress={() => { onClose(); navigate('profile.home'); }} />
        <SidebarEntry icon="settings" label="设置" onPress={() => { onClose(); navigate('settings.home'); }} />
      </View>
    </View>
  );
}

/** 新会话：选 workspace → sessions.create（M3）。 */
function NewSessionSheet({ visible, onClose, onCreated }: Readonly<{ visible: boolean; onClose: () => void; onCreated: () => void }>) {
  const { palette } = usePreferences();
  const [workspaces, setWorkspaces] = useState<readonly { id: string; path: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const createSession = useDshStore((s) => s.createSession);
  const addWorkspace = useDshStore((s) => s.addWorkspace);

  const add = (): void => {
    const path = newPath.trim()
    if (path.length === 0) return
    setBusy(true)
    void addWorkspace(path).then((w) => {
      setBusy(false)
      if (w !== null) {
        setNewPath('')
        setWorkspaces((prev) => [...prev.filter((x) => x.id !== w.id), w])
        setError(null)
      } else {
        setError('添加失败：目录需是电脑上的绝对路径且存在')
      }
    })
  }

  const load = (): void => {
    setBusy(true)
    setError(null)
    void listWorkspaces().then((list) => {
      setWorkspaces(list)
      setBusy(false)
      if (list.length === 0) setError('Worker 上还没有 workspace（在电脑 dsh Web UI 里添加项目目录后重试）')
    })
  }

  const create = (cwd: string): void => {
    setBusy(true)
    void createSession(cwd).then((id) => {
      setBusy(false)
      if (id !== null) onCreated()
      else setError('创建失败（Worker 需以 --caps m3 运行）')
    })
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[sheetStyles.scrim, { backgroundColor: palette.scrim }]} onPress={onClose}>
        <Pressable style={[sheetStyles.sheet, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[sheetStyles.title, { color: palette.text }]}>选择 Workspace 创建会话</Text>
          {busy && <Text style={[sheetStyles.hint, { color: palette.textSecondary }]}>加载中…</Text>}
          {error !== null && <Text style={[sheetStyles.hint, { color: palette.error }]}>{error}</Text>}
          <View style={[sheetStyles.addRow, { borderColor: palette.border }]}>
            <TextInput
              style={[sheetStyles.addInput, { color: palette.text }]}
              placeholder="/绝对/路径（电脑上的项目目录）"
              placeholderTextColor={palette.textSecondary}
              value={newPath}
              onChangeText={setNewPath}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={[sheetStyles.addBtn, { backgroundColor: palette.brand }]} onPress={add} disabled={busy}>
              <Text style={sheetStyles.addBtnText}>添加</Text>
            </Pressable>
          </View>
          <ScrollView style={sheetStyles.list}>
            {workspaces.map((w) => (
              <Pressable key={w.id} style={[sheetStyles.item, { borderColor: palette.border }]} onPress={() => create(w.path)}>
                <Text style={[sheetStyles.itemTitle, { color: palette.text }]}>{w.title}</Text>
                <Text style={[sheetStyles.itemPath, { color: palette.textSecondary }]} numberOfLines={1}>{w.path}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function SidebarEntry({ icon, label, onPress }: Readonly<{ icon: 'user' | 'settings'; label: string; onPress: () => void }>) {
  const { palette } = usePreferences();
  return (
    <Pressable style={styles.entry} onPress={onPress}>
      <AppIcon name={icon} color={palette.textSecondary} size={18} />
      <Text style={[styles.entryLabel, { color: palette.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const sheetStyles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.x6 },
  sheet: { borderRadius: radii.card, padding: spacing.x4, maxHeight: 420 },
  title: { fontSize: 16, marginBottom: spacing.x2 },
  hint: { fontSize: 13, marginBottom: spacing.x2 },
  list: {},
  addRow: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, marginBottom: spacing.x2 },
  addInput: { flex: 1, padding: spacing.x2, fontSize: 13, fontFamily: 'Menlo' },
  addBtn: { paddingHorizontal: spacing.x3, justifyContent: 'center', borderRadius: radii.small, margin: spacing.x1 },
  addBtnText: { color: '#FFFFFF', fontSize: 13 },
  item: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  itemTitle: { fontSize: 15 },
  itemPath: { fontSize: 12, fontFamily: 'Menlo' },
});

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: spacing.x8, paddingHorizontal: spacing.x3 },
  sectionTitle: { fontSize: 12, marginBottom: spacing.x2, paddingHorizontal: spacing.x2 },
  addWorker: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x2 },
  addWorkerText: { fontSize: 14 },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x2, borderRadius: radii.control },
  dot: { width: 8, height: 8, borderRadius: 4 },
  workerText: { flex: 1 },
  workerName: { fontSize: 15 },
  workerStatus: { fontSize: 12 },
  sessionList: { flex: 1 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.x2, marginBottom: spacing.x2 },
  newButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.x1 },
  newButtonText: { fontSize: 12 },
  emptyText: { fontSize: 13, padding: spacing.x2 },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.x2,
    padding: spacing.x2, borderRadius: radii.control,
  },
  sessionTitle: { flex: 1, fontSize: 14 },
  footer: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.x2, gap: spacing.x4 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x1 },
  entryLabel: { fontSize: 14 },
});
