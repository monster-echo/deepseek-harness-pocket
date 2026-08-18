/**
 * Worker 侧边栏（层级：Worker → 工作区 → 会话）：
 *   - 顶层「我的电脑」：多 Worker 切换 + 常驻「添加电脑」
 *   - 当前 Worker 的工作区列表：每个工作区可「快速新建会话」（+）、长按重命名/删除
 *   - 工作区下的会话：语义标题 + human-readable 时间，按最后活动倒序
 *   - 顶部搜索框：实时过滤工作区与会话
 *   - 底部 footer：我的 / 设置（垂直，固定）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { Sheet } from '../../design-system/Sheet';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import type { SessionListItem } from '../conversation/reducer';
import { spacing, radii } from '../../theme/tokens';
import { DirectoryPickerSheet } from './DirectoryPickerSheet';

interface WorkspaceRow { id: string; path: string; title: string }

/** human-readable 时间：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 / MM-DD。 */
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

export function WorkerSidebar({ onClose }: Readonly<{ onClose: () => void }>) {
  const { palette } = usePreferences();
  const { navigate, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [newSheet, setNewSheet] = useState<WorkspaceRow | null>(null);
  const [actionTarget, setActionTarget] = useState<WorkspaceRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<WorkspaceRow | null>(null);
  const [renameText, setRenameText] = useState('');
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceRow[]>([]);

  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const sessions = useDshStore((s) => s.sessions);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const openWorker = useDshStore((s) => s.openWorker);
  const openSession = useDshStore((s) => s.openSession);
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const renameWorkspace = useDshStore((s) => s.renameWorkspace);
  const deleteWorkspace = useDshStore((s) => s.deleteWorkspace);

  useEffect(() => {
    if (activeWorkerId === null) { setWorkspaces([]); return }
    void listWorkspaces().then(setWorkspaces)
  }, [activeWorkerId, listWorkspaces])

  const q = query.trim().toLowerCase()
  const online = workers.filter((w) => w.online).length

  // 会话按 cwd 分组；搜索词同时过滤会话标题/cwd 与工作区标题/路径
  const groups = useMemo(() => {
    const filtered = q.length === 0
      ? sessions
      : sessions.filter((s) => s.title.toLowerCase().includes(q) || (s.cwd ?? '').toLowerCase().includes(q))
    const byCwd = new Map<string, SessionListItem[]>()
    for (const s of filtered) {
      const cwd = s.cwd ?? ''
      const list = byCwd.get(cwd) ?? []
      list.push(s)
      byCwd.set(cwd, list)
    }
    const wsByPath = new Map(workspaces.map((w) => [w.path, w]))
    const entries = [...byCwd.entries()].sort((a, b) => b[1][0].lastActivityAt - a[1][0].lastActivityAt)
    return entries.map(([cwd, list]) => {
      const ws = wsByPath.get(cwd)
      const visible = q.length === 0 || list.length > 0 || (ws !== undefined && (ws.title.toLowerCase().includes(q) || ws.path.toLowerCase().includes(q)))
      return {
        key: cwd,
        workspace: ws ?? null,
        title: ws?.title ?? (cwd.length > 0 ? cwd.split('/').filter(Boolean).pop() ?? cwd : '未分组'),
        cwd,
        sessions: list,
        visible,
      }
    }).filter((g) => g.visible)
  }, [sessions, workspaces, q])

  const doRename = (): void => {
    if (renameTarget === null || renameText.trim().length === 0) return
    void renameWorkspace(renameTarget.id, renameText.trim()).then((ok) => {
      if (ok) {
        setWorkspaces((prev) => prev.map((w) => (w.id === renameTarget.id ? { ...w, title: renameText.trim() } : w)))
        showToast('工作区已重命名', 'success')
      } else {
        showToast('重命名失败', 'error')
      }
      setRenameTarget(null)
      setRenameText('')
    })
  }

  const doDelete = (w: WorkspaceRow): void => {
    setActionTarget(null)
    void deleteWorkspace(w.id).then((ok) => {
      if (ok) {
        setWorkspaces((prev) => prev.filter((x) => x.id !== w.id))
        showToast('工作区已删除', 'success')
      } else {
        showToast('删除失败', 'error')
      }
    })
  }

  const quickCreate = (cwd: string): void => {
    setNewSheet({ id: '', path: cwd, title: '' })
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      {/* Worker 切换器 */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>我的电脑</Text>
        <Text style={[styles.sectionMeta, { color: palette.textSecondary }]}>{online} 台在线</Text>
      </View>
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
            <Text style={[styles.workerName, { color: palette.text }]} numberOfLines={1}>{worker.name}</Text>
            <Text style={[styles.workerStatus, { color: palette.textSecondary }]}>{worker.online ? '在线' : '离线'}</Text>
          </View>
        </Pressable>
      ))}

      {/* 搜索框 + 视图切换 */}
      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { borderColor: palette.border, backgroundColor: palette.surfaceMuted, flex: 1 }]}>
          <AppIcon name="home" color={palette.textSecondary} size={14} />
          <TextInput
            style={[styles.searchInput, { color: palette.text }]}
            placeholder="搜索工作区 / 会话…"
            placeholderTextColor={palette.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <AppIcon name="close" color={palette.textSecondary} size={14} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.viewToggle, { borderColor: palette.border }]}
          onPress={() => setViewMode(viewMode === 'grouped' ? 'flat' : 'grouped')}
          hitSlop={8}
        >
          <AppIcon name={viewMode === 'grouped' ? 'home' : 'minus'} color={palette.textSecondary} size={14} />
          <Text style={[styles.viewToggleText, { color: palette.textSecondary }]}>{viewMode === 'grouped' ? '分组' : '列表'}</Text>
        </Pressable>
      </View>

      {/* 工作区 → 会话 */}
      {activeWorkerId !== null && (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {groups.length === 0 && (
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
              {sessions.length === 0 ? '暂无会话' : '无匹配结果'}
            </Text>
          )}
          {viewMode === 'flat' ? (
            // 单列表：扁平按最近更新
            [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
              .filter((s) => q.length === 0 || s.title.toLowerCase().includes(q) || (s.cwd ?? '').toLowerCase().includes(q))
              .map((session) => (
                <Pressable
                  key={session.id}
                  style={[styles.sessionRow, activeSessionId === session.id && { backgroundColor: palette.brandSoft }]}
                  onPress={() => { openSession(session.id); onClose(); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sessionTitle, { color: palette.text }]} numberOfLines={1}>{session.title}</Text>
                    <Text style={[styles.sessionTime, { color: palette.textSecondary }]}>{formatRelativeTime(session.lastActivityAt)}</Text>
                  </View>
                  {session.agentStatus === 'running' && <View style={[styles.dot, { backgroundColor: palette.warning }]} />}
                </Pressable>
              ))
          ) : (
            groups.map((group) => (
              <View key={group.key}>
                {/* 工作区行：标题 + 快速新建 + 长按重命名/删除 */}
                <Pressable
                  style={styles.workspaceRow}
                  onLongPress={() => group.workspace !== null && setActionTarget(group.workspace)}
                  delayLongPress={350}
                >
                  <AppIcon name="home" color={palette.textSecondary} size={13} />
                  <Text style={[styles.workspaceTitle, { color: palette.textSecondary }]} numberOfLines={1}>
                    {group.title}
                  </Text>
                  <Text style={[styles.workspaceCount, { color: palette.textSecondary }]}>{group.sessions.length}</Text>
                  {group.workspace !== null && (
                    <Pressable onPress={() => quickCreate(group.cwd)} hitSlop={8} style={styles.workspaceAdd}>
                      <AppIcon name="plus" color={palette.brand} size={14} />
                    </Pressable>
                  )}
                </Pressable>
                {group.sessions.map((session) => (
                  <Pressable
                    key={session.id}
                    style={[styles.sessionRow, activeSessionId === session.id && { backgroundColor: palette.brandSoft }]}
                    onPress={() => { openSession(session.id); onClose(); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sessionTitle, { color: palette.text }]} numberOfLines={1}>{session.title}</Text>
                      <Text style={[styles.sessionTime, { color: palette.textSecondary }]}>{formatRelativeTime(session.lastActivityAt)}</Text>
                    </View>
                    {session.agentStatus === 'running' && <View style={[styles.dot, { backgroundColor: palette.warning }]} />}
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* 新建会话（可预选工作区） */}
      <NewSessionSheet
        visible={newSheet !== null}
        presetWorkspace={newSheet ?? undefined}
        onClose={() => setNewSheet(null)}
        onCreated={() => { setNewSheet(null); onClose(); }}
      />

      {/* 工作区操作：重命名 / 删除 */}
      <Sheet visible={actionTarget !== null} title={actionTarget?.title ?? '工作区'} onClose={() => setActionTarget(null)} snapPoints={['50%']}>
        <Pressable style={[styles.actionRow, { borderColor: palette.border }]} onPress={() => { setRenameTarget(actionTarget); setRenameText(actionTarget?.title ?? ''); setActionTarget(null); }}>
          <AppIcon name="palette" color={palette.text} size={16} />
          <Text style={[styles.actionText, { color: palette.text }]}>重命名</Text>
        </Pressable>
        <Pressable style={[styles.actionRow, { borderColor: palette.border }]} onPress={() => actionTarget !== null && doDelete(actionTarget)}>
          <AppIcon name="trash" color={palette.error} size={16} />
          <Text style={[styles.actionText, { color: palette.error }]}>删除工作区</Text>
        </Pressable>
      </Sheet>

      {/* 重命名输入 */}
      <Sheet visible={renameTarget !== null} title="重命名工作区" onClose={() => setRenameTarget(null)} snapPoints={['50%']}>
        <TextInput
          style={[styles.renameInput, { color: palette.text, borderColor: palette.border }]}
          value={renameText}
          onChangeText={setRenameText}
          placeholder="工作区名称"
          placeholderTextColor={palette.textSecondary}
          autoFocus
        />
        <Pressable style={[styles.renameBtn, { backgroundColor: palette.brand }]} onPress={doRename}>
          <Text style={styles.renameBtnText}>确定</Text>
        </Pressable>
      </Sheet>

      {/* 底部入口 */}
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <SidebarEntry icon="user" label="我的" onPress={() => { onClose(); navigate('profile.home'); }} />
        <SidebarEntry icon="settings" label="设置" onPress={() => { onClose(); navigate('settings.home'); }} />
      </View>
    </View>
  );
}

/** 新建会话：选 workspace → sessions.create（底部 Sheet ≥50%）。 */
function NewSessionSheet({ visible, presetWorkspace, onClose, onCreated }: Readonly<{ visible: boolean; presetWorkspace?: WorkspaceRow; onClose: () => void; onCreated: () => void }>) {
  const { palette } = usePreferences();
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const createSession = useDshStore((s) => s.createSession);
  const addWorkspace = useDshStore((s) => s.addWorkspace);

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

  // 快速新建：预选了工作区则直接创建
  useEffect(() => {
    if (visible && presetWorkspace !== undefined && presetWorkspace.path.length > 0 && !busy) {
      create(presetWorkspace.path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, presetWorkspace])

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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, marginTop: spacing.x2, marginBottom: spacing.x1 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, paddingHorizontal: spacing.x2, paddingVertical: spacing.x1 },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },
  viewToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.x1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, paddingHorizontal: spacing.x2, paddingVertical: spacing.x1 },
  viewToggleText: { fontSize: 12 },
  list: { flex: 1, marginTop: spacing.x1 },
  emptyText: { fontSize: 13, padding: spacing.x2 },
  workspaceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x2, paddingHorizontal: spacing.x1, marginTop: spacing.x1 },
  workspaceTitle: { flex: 1, fontSize: 12, fontWeight: '600' },
  workspaceCount: { fontSize: 11 },
  workspaceAdd: { padding: spacing.x1 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x2, paddingHorizontal: spacing.x2, borderRadius: radii.control },
  sessionTitle: { fontSize: 14 },
  sessionTime: { fontSize: 11, marginTop: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  actionText: { fontSize: 14 },
  renameInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, fontSize: 15, marginBottom: spacing.x3 },
  renameBtn: { borderRadius: radii.control, alignItems: 'center', paddingVertical: spacing.x3 },
  renameBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.x1, gap: spacing.x1 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x2, borderRadius: radii.control },
  entryLabel: { fontSize: 14 },
});
