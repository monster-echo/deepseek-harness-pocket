/**
 * 主界面外壳：侧边栏（默认收起）+ 会话聊天主区域（最大化）。
 * 登录后首屏；无 Worker 时引导去配对。
 */

import React, { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';
import { ConversationScreen } from '../conversation/ConversationScreen';
import { SessionMenuSheet } from '../conversation/SessionMenuSheet';
import { SessionSidebar } from './SessionSidebar';

const SIDEBAR_WIDTH = 300

export function HomeShellScreen() {
  const { palette } = usePreferences();
  const { navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const translate = useState(new Animated.Value(-SIDEBAR_WIDTH))[0];
  const connectGateway = useDshStore((s) => s.connectGateway);
  const workers = useDshStore((s) => s.workers);
  const gatewayStatus = useDshStore((s) => s.gatewayStatus);
  const activeWorker = useDshStore((s) => s.workers.find((w) => w.workerId === s.activeWorkerId));
  const sessionCount = useDshStore((s) => s.sessions.length);

  useEffect(() => {
    connectGateway();
  }, [connectGateway]);

  const showSidebar = (visible: boolean): void => {
    setOpen(visible);
    Animated.timing(translate, {
      toValue: visible ? 0 : -SIDEBAR_WIDTH,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const hasWorker = workers.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* 顶栏：菜单 + 当前 Worker + 连接状态 */}
      <View style={[styles.topBar, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <Pressable style={styles.menuButton} onPress={() => showSidebar(!open)} hitSlop={12}>
          <AppIcon name="home" color={palette.text} size={22} />
        </Pressable>
        <View style={styles.topTitle}>
          <Text style={[styles.workerName, { color: palette.text }]} numberOfLines={1}>
            {activeWorker?.name ?? 'DSH Companion'}
          </Text>
          <Text style={[styles.workerSub, { color: palette.textSecondary }]} numberOfLines={1}>
            {gatewayStatus === 'connected'
              ? hasWorker
                ? `${workers.filter((w) => w.online).length} 台在线 · ${sessionCount} 个会话`
                : '尚未添加电脑'
              : gatewayStatus === 'connecting'
                ? '连接中…'
                : '网关未连接'}
          </Text>
        </View>
        {hasWorker && (
          <Pressable style={styles.menuButton} onPress={() => setMenu(true)} hitSlop={8}>
            <AppIcon name="settings" color={palette.text} size={20} />
          </Pressable>
        )}
        {!hasWorker && (
          <Pressable style={[styles.addPair, { backgroundColor: palette.brand }]} onPress={() => navigate('dsh.pair')}>
            <Text style={styles.addPairText}>配对电脑</Text>
          </Pressable>
        )}
      </View>

      {/* 主区域：会话聊天（最大化） */}
      <View style={styles.main}>
        {!hasWorker ? <EmptyWorker /> : <ConversationScreen />}
      </View>

      <SessionMenuSheet visible={menu} onClose={() => setMenu(false)} />

      {/* 侧边栏抽屉 */}
      {open && (
        <Pressable style={[styles.scrim, { backgroundColor: palette.scrim }]} onPress={() => showSidebar(false)}>
          <Animated.View style={[styles.sidebar, { backgroundColor: palette.surface, transform: [{ translateX: translate }] }]}>
            <SessionSidebar onClose={() => showSidebar(false)} />
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
}

function EmptyWorker() {
  const { palette } = usePreferences();
  const { navigate } = useApp();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>还没有可用的电脑</Text>
      <Text style={[styles.emptyBody, { color: palette.textSecondary }]}>
        在电脑上安装 dshc 并开机自启，{'\n'}然后用手机配对码绑定到你的账号。
      </Text>
      <Pressable style={[styles.emptyButton, { backgroundColor: palette.brand }]} onPress={() => navigate('dsh.pair')}>
        <Text style={styles.emptyButtonText}>查看安装指引</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.x2,
    paddingHorizontal: spacing.x3, paddingTop: spacing.x6, paddingBottom: spacing.x2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuButton: { padding: spacing.x1 },
  topTitle: { flex: 1 },
  workerName: { fontSize: 16 },
  workerSub: { fontSize: 12 },
  addPair: { paddingHorizontal: spacing.x3, paddingVertical: spacing.x2, borderRadius: radii.round },
  addPairText: { color: '#FFFFFF', fontSize: 13 },
  main: { flex: 1 },
  scrim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 10 },
  sidebar: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    width: SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.x6, gap: spacing.x3 },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyButton: { paddingHorizontal: spacing.x6, paddingVertical: spacing.x3, borderRadius: radii.round, marginTop: spacing.x2 },
  emptyButtonText: { color: '#FFFFFF', fontSize: 15 },
});
