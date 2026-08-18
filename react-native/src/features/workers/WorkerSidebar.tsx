/**
 * Worker 侧边栏，自上而下：logo → 新会话 → 工作区 → 当前 worker → 当前 user → 设置。
 *   - 无当前 worker：工作区区域提示「选择电脑」，点击进入配对/选择页（dsh.pair）
 *   - 未登录：底部「我的」显示「登录」，点击去登录
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { Sheet } from '../../design-system/Sheet';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import type { SessionListItem } from '../conversation/reducer';
import { spacing, radii } from '../../theme/tokens';
import { DirectoryPickerSheet } from './DirectoryPickerSheet';

interface WorkspaceRow { id: string; path: string; title: string }
const LOGO = require('../../../assets/brand/logo.png') // eslint-disable-line @typescript-eslint/no-require-imports
const LOGO_DARK = require('../../../assets/brand/logo-dark.png') // eslint-disable-line @typescript-eslint/no-require-imports

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
  const { palette, dark } = usePreferences();
  const { navigate, user } = useApp();
  const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<'workspace' | 'flat'>('workspace');
  const [sorting, setSorting] = useState<'manual' | 'recent'>('recent');
  const [viewSheet, setViewSheet] = useState(false);
  const [newSheet, setNewSheet] = useState<WorkspaceRow | null>(null);
  const [actionTarget, setActionTarget] = useState<WorkspaceRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<WorkspaceRow | null>(null);
  const [renameText, setRenameText] = useState('');
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceRow[]>([]);

  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const activeWorker = useDshStore((s) => s.workers.find((w) => w.workerId === s.activeWorkerId));
  const sessions = useDshStore((s) => s.sessions);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const openWorker = useDshStore((s) => s.openWorker);
  const openSession = useDshStore((s) => s.openSession);
  const startNewSession = useDshStore((s) => s.startNewSession);
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const renameWorkspace = useDshStore((s) => s.renameWorkspace);
  const deleteWorkspace = useDshStore((s) => s.deleteWorkspace);
  const pinnedSessionIds = useDshStore((s) => s.pinnedSessionIds);
  const togglePinSession = useDshStore((s) => s.togglePinSession);

  useEffect(() => {
    if (activeWorkerId === null) { setWorkspaces([]); return }
    void listWorkspaces().then(setWorkspaces)
  }, [activeWorkerId, listWorkspaces])

  const q = query.trim().toLowerCase()
  const online = workers.filter((w) => w.online).length
  const signedIn = user !== null

  const sortList = (list: SessionListItem[]): SessionListItem[] => {
    if (sorting === 'recent') return [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    return [...list].sort((a, b) => {
      const ap = pinnedSessionIds.includes(a.id) ? 1 : 0
      const bp = pinnedSessionIds.includes(b.id) ? 1 : 0
      if (ap !== bp) return bp - ap
      return b.lastActivityAt - a.lastActivityAt
    })
  }

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
    const sortSessions = sortList
    for (const [cwd, list] of byCwd) byCwd.set(cwd, sortSessions(list))
    const wsByPath = new Map(workspaces.map((w) => [w.path, w]))
    return [...byCwd.entries()].sort((a, b) => {
      const ap = a[1].some((s) => pinnedSessionIds.includes(s.id)) ? 1 : 0
      const bp = b[1].some((s) => pinnedSessionIds.includes(s.id)) ? 1 : 0
      if (sorting === 'manual' && ap !== bp) return bp - ap
      return b[1][0].lastActivityAt - a[1][0].lastActivityAt
    })
      .map(([cwd, list]) => {
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
      })
      .filter((g) => g.visible)
  }, [sessions, workspaces, q, sorting, pinnedSessionIds])

  const doRename = (): void => {
    if (renameTarget === null || renameText.trim().length === 0) return
    void renameWorkspace(renameTarget.id, renameText.trim()).then((ok) => {
      if (ok) {
        setWorkspaces((prev) => prev.map((w) => (w.id === renameTarget.id ? { ...w, title: renameText.trim() } : w)))
      }
      setRenameTarget(null)
      setRenameText('')
    })
  }

  const doDelete = (w: WorkspaceRow): void => {
    setActionTarget(null)
    void deleteWorkspace(w.id).then((ok) => {
      if (ok) setWorkspaces((prev) => prev.filter((x) => x.id !== w.id))
    })
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      {/* 顶部：logo */}
      <View style={styles.logoRow}>
        <Image source={dark ? LOGO_DARK : LOGO} style={styles.logo} accessibilityLabel="掌鲸 DSH Pocket" />
        <Text style={[styles.logoName, { color: palette.text }]}>掌鲸 DSH Pocket</Text>
      </View>

      {/* 新会话 */}
      <Pressable
        style={[styles.newSessionBtn, { backgroundColor: palette.brand }]}
        onPress={() => { startNewSession(); onClose(); }}
      >
        <AppIcon name="plus" color="#FFFFFF" size={16} />
        <Text style={styles.newSessionText}>新会话</Text>
      </Pressable>

      {/* 搜索 + 视图切换 */}
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
          onPress={() => setViewSheet(true)}
          hitSlop={8}
        >
          <AppIcon name="settings" color={palette.textSecondary} size={14} />
        </Pressable>
      </View>

      {/* 工作区 → 会话（无 worker 时引导选择） */}
      <View style={styles.midArea}>
        {activeWorkerId === null ? (
          <Pressable style={styles.noWorker} onPress={() => { onClose(); navigate('dsh.pair'); }}>
            <AppIcon name="alert" color={palette.brand} size={20} />
            <Text style={[styles.noWorkerText, { color: palette.text }]}>还没有选择电脑</Text>
            <Text style={[styles.noWorkerSub, { color: palette.textSecondary }]}>点击选择或配对一台电脑</Text>
          </Pressable>
        ) : (
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {groups.length === 0 && (
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
                {sessions.length === 0 ? '暂无会话' : '无匹配结果'}
              </Text>
            )}
            {grouping === 'flat' ? (
              sortList(sessions.filter((s) => q.length === 0 || s.title.toLowerCase().includes(q) || (s.cwd ?? '').toLowerCase().includes(q)))
                .map((session) => <SessionRow key={session.id} session={session} active={activeSessionId === session.id} onPress={() => { openSession(session.id); onClose(); }} onLongPress={() => togglePinSession(session.id)} pinned={pinnedSessionIds.includes(session.id)} />)
            ) : (
              groups.map((group) => (
                <View key={group.key}>
                  <Pressable
                    style={styles.workspaceRow}
                    onLongPress={() => group.workspace !== null && setActionTarget(group.workspace)}
                    delayLongPress={350}
                  >
                    <AppIcon name="home" color={palette.textSecondary} size={13} />
                    <Text style={[styles.workspaceTitle, { color: palette.textSecondary }]} numberOfLines={1}>{group.title}</Text>
                    <Text style={[styles.workspaceCount, { color: palette.textSecondary }]}>{group.sessions.length}</Text>
                    {group.workspace !== null && (
                      <Pressable onPress={() => setNewSheet({ id: '', path: group.cwd, title: '' })} hitSlop={8} style={styles.workspaceAdd}>
                        <AppIcon name="plus" color={palette.brand} size={14} />
                      </Pressable>
                    )}
                  </Pressable>
                  {group.sessions.map((session) => <SessionRow key={session.id} session={session} active={activeSessionId === session.id} onPress={() => { openSession(session.id); onClose(); }} onLongPress={() => togglePinSession(session.id)} pinned={pinnedSessionIds.includes(session.id)} />)}
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>

      {/* 底部：当前 worker → 当前 user → 设置 */}
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <FooterEntry icon="settings" label={activeWorker !== undefined ? activeWorker.name : '选择电脑'} sub={activeWorker !== undefined ? (activeWorker.online ? '在线' : '离线') : undefined} onPress={() => { onClose(); navigate('dsh.pair'); }} />
        <FooterEntry icon="user" label={signedIn ? '我的' : '登录'} onPress={() => { onClose(); navigate(signedIn ? 'profile.home' : 'auth.signIn'); }} />
        <FooterEntry icon="settings" label="设置" onPress={() => { onClose(); navigate('settings.home'); }} />
      </View>

      {/* Sheets */}
      {/* 视图选项：分组 + 排序 两维度 */}
      <Sheet visible={viewSheet} title="视图选项" onClose={() => setViewSheet(false)} snapPoints={['55%']}>
        <Text style={[styles.viewSectionLabel, { color: palette.textSecondary }]}>分组</Text>
        <Pressable style={[styles.actionRow, { borderColor: palette.border }]} onPress={() => { setGrouping('workspace'); setViewSheet(false); }}>
          <Text style={[styles.actionText, { color: palette.text }]}>按工作区</Text>
          {grouping === 'workspace' && <AppIcon name="check" color={palette.brand} size={16} />}
        </Pressable>
        <Pressable style={[styles.actionRow, { borderColor: palette.border }]} onPress={() => { setGrouping('flat'); setViewSheet(false); }}>
          <Text style={[styles.actionText, { color: palette.text }]}>单列表</Text>
          {grouping === 'flat' && <AppIcon name="check" color={palette.brand} size={16} />}
        </Pressable>
        <Text style={[styles.viewSectionLabel, { color: palette.textSecondary }]}>排序</Text>
        <Pressable style={[styles.actionRow, { borderColor: palette.border }]} onPress={() => { setSorting('manual'); setViewSheet(false); }}>
          <Text style={[styles.actionText, { color: palette.text }]}>手动排序</Text>
          {sorting === 'manual' && <AppIcon name="check" color={palette.brand} size={16} />}
        </Pressable>
        <Pressable style={[styles.actionRow, { borderColor: palette.border }]} onPress={() => { setSorting('recent'); setViewSheet(false); }}>
          <Text style={[styles.actionText, { color: palette.text }]}>最近更新</Text>
          {sorting === 'recent' && <AppIcon name="check" color={palette.brand} size={16} />}
        </Pressable>
      </Sheet>
      <NewSessionSheet
        visible={newSheet !== null}
        presetWorkspace={newSheet && newSheet.path.length > 0 ? newSheet : undefined}
        onClose={() => setNewSheet(null)}
        onCreated={() => { setNewSheet(null); onClose(); }}
      />
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
    </View>
  );
}

function SessionRow({ session, active, pinned, onPress, onLongPress }: Readonly<{ session: SessionListItem; active: boolean; pinned?: boolean; onPress: () => void; onLongPress?: () => void }>) {
  const { palette } = usePreferences();
  return (
    <Pressable style={[styles.sessionRow, active && { backgroundColor: palette.brandSoft }]} onPress={onPress} onLongPress={onLongPress} delayLongPress={350}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sessionTitle, { color: palette.text }]} numberOfLines={1}>{session.title}</Text>
        <Text style={[styles.sessionTime, { color: palette.textSecondary }]}>{formatRelativeTime(session.lastActivityAt)}</Text>
      </View>
      {pinned === true && <AppIcon name="crown" color={palette.brand} size={12} />}
      {session.agentStatus === 'running' && <View style={[styles.dot, { backgroundColor: palette.warning }]} />}
    </Pressable>
  );
}

function FooterEntry({ icon, label, sub, onPress }: Readonly<{ icon: 'user' | 'settings'; label: string; sub?: string; onPress: () => void }>) {
  const { palette } = usePreferences();
  return (
    <Pressable style={styles.entry} onPress={onPress}>
      <AppIcon name={icon} color={palette.textSecondary} size={18} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryLabel, { color: palette.text }]}>{label}</Text>
        {sub !== undefined && <Text style={[styles.entrySub, { color: palette.textSecondary }]}>{sub}</Text>}
      </View>
    </Pressable>
  );
}

/** 新建会话：选 workspace → sessions.create。 */
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

  useEffect(() => {
    if (visible && presetWorkspace !== undefined && presetWorkspace.path.length > 0 && !busy) create(presetWorkspace.path)
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
      } else setError('添加失败：目录需是电脑上的绝对路径且存在')
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
            } else setError('添加失败：无法在电脑上创建该 workspace（目录不存在或无权限）')
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
  container: { flex: 1, paddingTop: spacing.x6, paddingHorizontal: spacing.x3 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingHorizontal: spacing.x1, marginBottom: spacing.x2 },
  logo: { width: 24, height: 24, borderRadius: 12 },
  logoName: { fontSize: 15, fontWeight: '700' },
  newSessionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x1, borderRadius: radii.control, paddingVertical: spacing.x2, marginBottom: spacing.x2 },
  newSessionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, marginBottom: spacing.x1 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, paddingHorizontal: spacing.x2, paddingVertical: spacing.x1 },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },
  viewToggle: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, paddingHorizontal: spacing.x2, paddingVertical: spacing.x2 },
  midArea: { flex: 1 },
  list: { flex: 1, marginTop: spacing.x1 },
  emptyText: { fontSize: 13, padding: spacing.x2 },
  noWorker: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.x2 },
  noWorkerText: { fontSize: 15, fontWeight: '600' },
  noWorkerSub: { fontSize: 13 },
  workspaceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x2, paddingHorizontal: spacing.x1, marginTop: spacing.x1 },
  workspaceTitle: { flex: 1, fontSize: 12, fontWeight: '600' },
  workspaceCount: { fontSize: 11 },
  workspaceAdd: { padding: spacing.x1 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x2, paddingHorizontal: spacing.x2, borderRadius: radii.control },
  sessionTitle: { fontSize: 14 },
  sessionTime: { fontSize: 11, marginTop: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.x1, gap: spacing.x1 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x2, borderRadius: radii.control },
  entryLabel: { fontSize: 14 },
  entrySub: { fontSize: 11 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  actionText: { fontSize: 14, flex: 1 },
  viewSectionLabel: { fontSize: 12, marginBottom: spacing.x1, marginTop: spacing.x1 },
  renameInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, fontSize: 15, marginBottom: spacing.x3 },
  renameBtn: { borderRadius: radii.control, alignItems: 'center', paddingVertical: spacing.x3 },
  renameBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
