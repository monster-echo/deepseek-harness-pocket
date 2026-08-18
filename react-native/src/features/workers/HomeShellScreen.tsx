/**
 * 主界面外壳：侧边栏（默认收起）+ 会话聊天主区域（最大化）。
 * 登录后首屏；无 Worker 时引导去配对。
 *
 * 顶栏（对齐 dsh Web）：
 *   左：汉堡菜单（开侧边栏）
 *   中：标题 + 副标题——会话中显示「模式 · 权限 · 在线数」（#19），否则品牌/连接状态
 *   右：会话信息按钮（#21）/ 无 Worker 时「配对电脑」
 */

import React, { useEffect, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';
import { ConversationScreen } from '../conversation/ConversationScreen';
import { SessionInfoSheet } from '../conversation/SessionInfoSheet';
import { SessionSidebar } from './SessionSidebar';

const SIDEBAR_WIDTH = 300
const LOGO = require('../../../assets/brand/logo.png') // eslint-disable-line @typescript-eslint/no-require-imports

const PRESET_LABELS: Readonly<Record<string, string>> = {
  standard: '标准', code: '代码编排', minimal: '极简', cordis: 'Cordis',
}
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'workspace-write': '工作区可写',
  'danger-full-access': '完全访问',
  'read-only': '只读',
  custom: '自定义',
}

export function HomeShellScreen() {
  const { palette } = usePreferences();
  const { navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const translate = useState(new Animated.Value(-SIDEBAR_WIDTH))[0];
  const connectGateway = useDshStore((s) => s.connectGateway);
  const workers = useDshStore((s) => s.workers);
  const gatewayStatus = useDshStore((s) => s.gatewayStatus);
  const activeWorker = useDshStore((s) => s.workers.find((w) => w.workerId === s.activeWorkerId));
  const sessionCount = useDshStore((s) => s.sessions.length);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const activeSessionTitle = useDshStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.title);
  const newSessionPreset = useDshStore((s) => s.newSessionPreset);
  const permission = useDshStore((s) => s.sessionView.permissionCurrent);

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
  const online = workers.filter((w) => w.online).length;

  const subtitle = (() => {
    if (!hasWorker) return '把 DeepSeek Harness 装进口袋'
    if (gatewayStatus !== 'connected') {
      return gatewayStatus === 'connecting' ? '连接中…' : '网关未连接'
    }
    if (activeSessionId !== null) {
      // #19：进入会话后，模式/权限上移到标题副标题
      const presetLabel = PRESET_LABELS[newSessionPreset.length > 0 ? newSessionPreset : 'standard'] ?? '标准'
      const permLabel = permission !== null ? (PERMISSION_LABELS[permission] ?? permission) : null
      return `${presetLabel}${permLabel !== null ? ` · ${permLabel}` : ''} · ${online} 台在线`
    }
    return hasWorker ? `${online} 台在线 · ${sessionCount} 个会话` : '尚未添加电脑'
  })();

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* 顶栏 */}
      <View style={[styles.topBar, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <Pressable style={styles.menuButton} onPress={() => showSidebar(!open)} hitSlop={12}>
          <AppIcon name="menu" color={palette.text} size={22} />
        </Pressable>
        <View style={styles.topTitle}>
          {hasWorker ? (
            <>
              <Text style={[styles.workerName, { color: palette.text }]} numberOfLines={1}>
                {activeSessionTitle ?? activeWorker?.name ?? '掌鲸 DSH Pocket'}
              </Text>
              <Text style={[styles.workerSub, { color: palette.textSecondary }]} numberOfLines={1}>
                {subtitle}
              </Text>
            </>
          ) : (
            <View style={styles.brandRow}>
              <Image source={LOGO} style={styles.brandLogo} accessibilityLabel="掌鲸 DSH Pocket" />
              <Text style={[styles.workerName, { color: palette.text }]}>掌鲸 DSH Pocket</Text>
            </View>
          )}
        </View>
        {activeSessionId !== null && hasWorker && (
          <Pressable style={styles.menuButton} onPress={() => setInfoOpen(true)} hitSlop={8}>
            <AppIcon name="info" color={palette.text} size={20} />
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

      <SessionInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} />

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
      <Image source={LOGO} style={styles.emptyLogo} accessibilityLabel="掌鲸 DSH Pocket" />
      <Text style={[styles.emptyTitle, { color: palette.text }]}>掌鲸 DSH Pocket</Text>
      <Text style={[styles.emptyBody, { color: palette.textSecondary }]}>
        还没有可用的电脑。在电脑上安装 dshc 并开机自启，{'\n'}然后用手机配对码绑定到你的账号。
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
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  brandLogo: { width: 22, height: 22, borderRadius: 11 },
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
  emptyLogo: { width: 72, height: 72, borderRadius: 36, marginBottom: spacing.x2 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyButton: { paddingHorizontal: spacing.x6, paddingVertical: spacing.x3, borderRadius: radii.round, marginTop: spacing.x2 },
  emptyButtonText: { color: '#FFFFFF', fontSize: 15 },
});
