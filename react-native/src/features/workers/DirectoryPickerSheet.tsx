/**
 * 远程目录树选择器：浏览 Worker 电脑的目录（fs.list），选择一个作为 workspace。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';

export function DirectoryPickerSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    onPicked: (path: string) => void;
  }>,
) {
  const { palette } = usePreferences();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<string>('/');
  const [dirs, setDirs] = useState<readonly { name: string; path: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<readonly string[]>([]);
  const listDir = useDshStore((s) => s.listDir);
  const fsHome = useDshStore((s) => s.fsHome);

  const load = useCallback((path: string) => {
    setLoading(true);
    void listDir(path).then((entries) => {
      setDirs(entries);
      setLoading(false);
    });
  }, [listDir]);

  useEffect(() => {
    if (!props.visible) return;
    void fsHome().then((home) => {
      setCurrent(home);
      load(home);
    });
  }, [props.visible, fsHome, load]);

  const enter = (dir: { name: string; path: string }): void => {
    setHistory((h) => [...h, current]);
    setCurrent(dir.path);
    load(dir.path);
  };

  const back = (): void => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1]!;
      setCurrent(prev);
      load(prev);
      return h.slice(0, -1);
    });
  };

  const crumbs = current.split('/').filter(Boolean);

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <View
        style={[
          styles.container,
          {
            backgroundColor: palette.background,
            paddingTop: insets.top + spacing.x1,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        {/* 顶栏 */}
        <View style={[styles.header, { borderBottomColor: palette.border }]}>
          <Pressable onPress={props.onClose} hitSlop={12}>
            <AppIcon name="close" color={palette.text} size={22} />
          </Pressable>
          <Text style={[styles.title, { color: palette.text }]}>选择电脑上的目录</Text>
          <Pressable onPress={props.onClose} hitSlop={12}>
            <Text style={[styles.cancelText, { color: palette.brand }]}>取消</Text>
          </Pressable>
        </View>

        {/* 面包屑 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.crumbs, { paddingRight: spacing.x3 }]}
        >
          <Crumb label="/" path="/" current={current === '/'} onPress={() => { setCurrent('/'); load('/'); setHistory([]); }} />
          {crumbs.map((label, i) => {
            const path = `/${crumbs.slice(0, i + 1).join('/')}`;
            return (
              <Crumb
                key={path}
                label={label}
                path={path}
                current={current === path}
                onPress={() => { setCurrent(path); load(path); setHistory([]); }}
              />
            );
          })}
        </ScrollView>

        {/* 目录列表 */}
        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator
          contentContainerStyle={{ paddingBottom: spacing.x6 }}
        >
          {history.length > 0 && (
            <Row name=".." detail="返回上级" onPress={back} />
          )}
          {loading && <Text style={[styles.hint, { color: palette.textSecondary }]}>加载中…</Text>}
          {!loading && dirs.length === 0 && (
            <Text style={[styles.hint, { color: palette.textSecondary }]}>没有子目录（或无法访问）</Text>
          )}
          {dirs.map((dir) => (
            <Row key={dir.path} name={dir.name} detail="" onPress={() => enter(dir)} chevron />
          ))}
        </ScrollView>

        {/* 底部固定选择栏（避开 home indicator 由容器 paddingBottom 处理） */}
        <View style={[styles.footer, { borderTopColor: palette.border, backgroundColor: palette.surface }]}>
          <Text style={[styles.footerPath, { color: palette.textSecondary }]} numberOfLines={1}>
            {current}
          </Text>
          <Pressable style={[styles.pickButton, { backgroundColor: palette.brand }]} onPress={() => props.onPicked(current)}>
            <Text style={styles.pickText}>选这个目录</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Crumb(props: Readonly<{ label: string; path: string; current: boolean; onPress: () => void }>) {
  const { palette } = usePreferences();
  return (
    <Pressable style={[styles.crumb, props.current && { backgroundColor: palette.brandSoft }]} onPress={props.onPress}>
      <Text style={[styles.crumbText, { color: props.current ? palette.brand : palette.textSecondary }]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function Row(props: Readonly<{ name: string; detail: string; onPress: () => void; chevron?: boolean }>) {
  const { palette } = usePreferences();
  return (
    <Pressable style={[styles.row, { borderColor: palette.border }]} onPress={props.onPress}>
      <View style={[styles.rowIcon, { backgroundColor: palette.surfaceMuted }]}>
        <AppIcon name="chevron-right" color={palette.brand} size={16} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>{props.name}</Text>
        {props.detail.length > 0 && (
          <Text style={[styles.rowDetail, { color: palette.textSecondary }]} numberOfLines={1}>{props.detail}</Text>
        )}
      </View>
      {props.chevron === true && <AppIcon name="chevron-right" color={palette.textSecondary} size={16} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.x3,
    paddingHorizontal: spacing.x3, paddingBottom: spacing.x2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, flex: 1 },
  pickButton: { paddingHorizontal: spacing.x4, paddingVertical: spacing.x2, borderRadius: radii.round },
  pickText: { color: '#FFFFFF', fontSize: 13 },
  crumbs: { flexDirection: 'row', paddingHorizontal: spacing.x3, paddingVertical: spacing.x2, gap: spacing.x1, flexWrap: 'wrap' },
  crumb: { paddingHorizontal: spacing.x2, paddingVertical: spacing.x1, borderRadius: radii.small },
  crumbText: { fontSize: 12, maxWidth: 140 },
  cancelText: { fontSize: 15 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2, borderTopWidth: StyleSheet.hairlineWidth },
  footerPath: { flex: 1, fontSize: 12, fontFamily: 'Menlo' },
  list: { flex: 1, paddingHorizontal: spacing.x3 },
  hint: { fontSize: 13, padding: spacing.x3 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.x2,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control,
    backgroundColor: 'transparent', padding: spacing.x2, marginBottom: spacing.x2,
  },
  rowIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowName: { fontSize: 14 },
  rowDetail: { fontSize: 12 },
});
