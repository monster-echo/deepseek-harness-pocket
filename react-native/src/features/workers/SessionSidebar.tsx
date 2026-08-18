/**
 * 会话侧边栏：Worker 切换器（常驻「添加电脑」入口）+ 会话列表（按最后活动时间倒序，
 * 显示 human-readable 时间）+ 底部入口（我的/设置，垂直布局）。
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { Sheet } from '../../design-system/Sheet';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import type { SessionListItem as SessionListItemLocal } from '../conversation/reducer';
import { spacing, radii } from '../../theme/tokens';
import { DirectoryPickerSheet } from './DirectoryPickerSheet';

/** human-readable 时间（#16）：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 / MM-DD。 */
function formatRelativeTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  const today = new Date()
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
    return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return '昨天'
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}-${d.getDate()}`
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function SessionSidebar({ onClose }: Readonly<{ onClose: () => void }>) {
  const { palette } = usePreferences();
  const { navigate } = useApp();
  const [newSheet, setNewSheet] = useState(false);
  const [workspaceTitles, setWorkspaceTitles] = useState<Readonly<Record<string, string>>>({});
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const sessions = useDshStore((s) => s.sessions);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const openWorker = useDshStore((s) => s.openWorker);
  const openSession = useDshStore((s) => s.openSession);

  useEffect(() => {
    if (activeWorkerId === null) return
    void listWorkspaces().then((list) => {
      const map: Record<string, string> = {}
      for (const w of list) map[w.path] = w.title
      setWorkspaceTitles(map)
    })
  }, [activeWorkerId, listWorkspaces])

  // 会话按 cwd 分组（#17 对齐 dsh workspace）；组间按「组内最新活动时间」倒序（#16）
  const groups: ReadonlyArray<{ key: string; title: string; sessions: SessionListItemLocal[] }> = (() => {
    const byCwd = new Map<string, SessionListItemLocal[]>()
    for (const session of sessions) {
      const cwd = session.cwd ?? ''
      const list = byCwd.get(cwd) ?? []
      list.push(session)
      byCwd.set(cwd, list)
    }
    return [...byCwd.entries()]
      .sort((a, b) => (b[1][0].lastActivityAt - a[1][0].lastActivityAt) || a[0].localeCompare(b[0]))
      .map(([cwd, list]) => ({
        key: cwd,
        title: cwd.length > 0 ? (workspaceTitles[cwd] ?? cwd.split('/').filter(Boolean).pop() ?? cwd) : '未指定目录',
        sessions: list,
      }))
  })()

  const online = workers.filter((w) => w.online).length

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      {/* Worker 切换器 */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>我的电脑</Text>
        <Text style={[styles.sectionMeta, { color: palette.textSecondary }]}>{online} 台在线</Text>
      </View>
      {/* 常驻「添加电脑」入口（#4）：即使已有 Worker 也可添加 */}
      <Pressable style={styles.addWorker} onPress={() => { onClose(); navigate('dsh.pair'); }}>
        <AppIcon name="plus" color={palette.brand} size={18} />
        <Text style={[styles.addWorkerText, { color: palette.brand }]}>添加电脑（Worker）</Text>
      </Pressable>
      {workers.map((worker) => (
        <Pressable
          key={worker.workerId}
          style={[styles.workerRow, activeWorkerId === worker.workerId && { backgroundColor: palette.brandSoft }]}
          onPress={() => { if (activeWorkerId !== worker.workerId) openWorker(worker.workerId) }}
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
            {groups.map((group) => (
              <View key={group.key}>
                <Text style={[styles.groupTitle, { color: palette.textSecondary }]} numberOfLines={1}>
                  {group.title} · {group.sessions.length}
                </Text>
                {group.sessions.map((session) => (
                  <Pressable
                    key={session.id}
                    style={[styles.sessionRow, activeSessionId === session.id && { backgroundColor: palette.brandSoft }]}
                    onPress={() => { openSession(session.id); onClose(); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sessionTitle, { color: palette.text }]} numberOfLines={1}>
                        {session.title}
                      </Text>
                      <Text style={[styles.sessionTime, { color: palette.textSecondary }]}>
                        {formatRelativeTime(session.lastActivityAt)}
                      </Text>
                    </View>
                    {session.agentStatus === 'running' && (
                      <View style={[styles.dot, { backgroundColor: palette.warning }]} />
                    )}
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </>
      )}

      <NewSessionSheet
        visible={newSheet}
        onClose={() => setNewSheet(false)}
        onCreated={() => { setNewSheet(false); onClose(); }}
      />

      {/* 底部入口（#5：我的/设置垂直布局） */}
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <SidebarEntry icon="user" label="我的" onPress={() => { onClose(); navigate('profile.home'); }} />
        <SidebarEntry icon="settings" label="设置" onPress={() => { onClose(); navigate('settings.home'); }} />
      </View>
    </View>
  );
}

/** 新会话：选 workspace → sessions.create（底部 Sheet ≥50%，#12）。 */
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

  const [picker, setPicker] = useState(false)

  useEffect(() => {
    if (!visible) return
    setBusy(true)
    setError(null)
    void listWorkspaces().then((list) => {
      setWorkspaces(list)
      setBusy(false)
      if (list.length === 0) setError('Worker 上还没有 workspace（在电脑 dsh Web UI 里添加项目目录后重试）')
    })
  }, [visible, listWorkspaces])

  const create = (cwd: string): void => {
    setBusy(true)
    void createSession(cwd).then((id) => {
      setBusy(false)
      if (id !== null) onCreated()
      else setError('创建失败（Worker 需以 --caps m3 运行）')
    })
  }

  return (
    <Sheet visible={visible} title="选择 Workspace 创建会话" onClose={onClose} scrollable snapPoints={['50%', '85%']}>
      {busy && <Text style={[sheetStyles.hint, { color: palette.textSecondary }]}>加载中…</Text>}
      {error !== null && <Text style={[sheetStyles.hint, { color: palette.error }]}>{error}</Text>}
      <Pressable style={[sheetStyles.browseButton, { borderColor: palette.brand }]} onPress={() => setPicker(true)}>
        <AppIcon name="chevron-right" color={palette.brand} size={14} />
        <Text style={[sheetStyles.browseText, { color: palette.brand }]}>浏览电脑目录…</Text>
      </Pressable>
      <DirectoryPickerSheet
        visible={picker}
        onClose={() => setPicker(false)}
        onPicked={(path) => {
          setPicker(false)
          setBusy(true)
          void addWorkspace(path).then((w) => {
            setBusy(false)
            if (w !== null) {
              setNewPath('')
              setWorkspaces((prev) => [...prev.filter((x) => x.id !== w.id), w])
              setError(null)
            } else {
              setError('添加失败：无法在电脑上创建该 workspace（目录不存在或无权限）')
            }
          })
        }}
      />
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
    </Sheet>
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
  hint: { fontSize: 13, marginBottom: spacing.x2 },
  list: {},
  browseButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x1, borderWidth: 1, borderRadius: radii.control, paddingVertical: spacing.x2, marginBottom: spacing.x2 },
  browseText: { fontSize: 14 },
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.x2, marginBottom: spacing.x1 },
  sectionTitle: { fontSize: 12, paddingHorizontal: spacing.x2 },
  sectionMeta: { fontSize: 11, marginLeft: 'auto', paddingRight: spacing.x1 },
  addWorker: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x2, marginBottom: spacing.x1 },
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
  groupTitle: { fontSize: 11, paddingVertical: spacing.x1, paddingHorizontal: spacing.x2, marginTop: spacing.x2 },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.x2,
    padding: spacing.x2, borderRadius: radii.control,
  },
  sessionTitle: { fontSize: 14 },
  sessionTime: { fontSize: 11, marginTop: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.x1, gap: spacing.x1 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x2, borderRadius: radii.control },
  entryLabel: { fontSize: 14 },
});
