/**
 * 会话侧边栏：Worker 切换器 + 当前 Worker 会话列表 + 底部入口。
 * 手机默认收起（左上角按钮/遮罩打开）；内容由 HomeShellScreen 控制。
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';

export function SessionSidebar({ onClose }: Readonly<{ onClose: () => void }>) {
  const { palette } = usePreferences();
  const { navigate } = useApp();
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
          <Text style={[styles.sectionTitle, { color: palette.textSecondary, marginTop: spacing.x4 }]}>
            会话
          </Text>
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

      {/* 底部入口 */}
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <SidebarEntry icon="user" label="我的" onPress={() => { onClose(); navigate('profile.home'); }} />
        <SidebarEntry icon="settings" label="设置" onPress={() => { onClose(); navigate('settings.home'); }} />
      </View>
    </View>
  );
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
