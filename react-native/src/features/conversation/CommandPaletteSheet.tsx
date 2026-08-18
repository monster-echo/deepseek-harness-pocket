/**
 * 快捷命令 Sheet：单层命令列表，点按即以 /name 直接发送（免模型回合）。
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '../../design-system/Sheet';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import { radii, spacing } from '../../theme/tokens';

export function CommandPaletteSheet(props: Readonly<{ visible: boolean; onClose: () => void }>): React.JSX.Element {
  const { palette } = usePreferences()
  const { showToast } = useApp()
  const [commands, setCommands] = useState<readonly { name: string; description: string }[]>([])
  const listCommands = useDshStore((s) => s.listCommands)
  const sendMessage = useDshStore((s) => s.sendMessage)
  const notice = useDshStore((s) => s.notice)

  useEffect(() => {
    if (!props.visible) return
    void listCommands().then(setCommands)
  }, [props.visible, listCommands])

  const run = (name: string): void => {
    props.onClose()
    void sendMessage(`/${name}`)
    showToast(`已执行 /${name}`, 'info')
  }

  return (
    <Sheet visible={props.visible} title="快捷命令" onClose={props.onClose} scrollable snapPoints={['50%', '85%']}>
      <ScrollView style={styles.list}>
        {commands.map((cmd) => (
          <Pressable
            key={cmd.name}
            style={({ pressed }) => [styles.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surfaceMuted }]}
            onPress={() => run(cmd.name)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: palette.text, fontFamily: 'Menlo' }]}>/{cmd.name}</Text>
              <Text style={[styles.desc, { color: palette.textSecondary }]} numberOfLines={1}>{cmd.description}</Text>
            </View>
            <AppIcon name="chevron-right" color={palette.textSecondary} size={14} />
          </Pressable>
        ))}
        {commands.length === 0 && (
          <Text style={[styles.empty, { color: palette.textSecondary }]}>
            {notice ?? '命令目录为空（需活跃会话）'}
          </Text>
        )}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  list: { maxHeight: 380 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  name: { fontSize: 14, fontWeight: '600' },
  desc: { fontSize: 12 },
  empty: { fontSize: 13, padding: spacing.x3, textAlign: 'center' },
})
