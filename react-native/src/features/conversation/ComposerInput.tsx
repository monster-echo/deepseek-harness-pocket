/**
 * 共享输入框（composer 核心）：大圆角一体框，发送/停止内嵌右侧。
 * session 与 new session 复用；功能按钮由调用方自行渲染在上方。
 */

import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { spacing, radii } from '../../theme/tokens';

export function ComposerInput(props: Readonly<{
  text: string;
  onChangeText: (t: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  running: boolean;
  canSend: boolean;
  placeholder?: string;
}>): React.JSX.Element {
  const { palette } = usePreferences()
  return (
    <View style={[styles.inputShell, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
      <TextInput
        style={[styles.input, { color: palette.text }]}
        placeholder={props.placeholder ?? '描述你想要构建的内容…'}
        placeholderTextColor={palette.textSecondary}
        value={props.text}
        onChangeText={props.onChangeText}
        multiline
        numberOfLines={1}
      />
      {props.running ? (
        <Pressable style={styles.sendInline} onPress={props.onStop} hitSlop={6}>
          <View style={[styles.stopSquare, { backgroundColor: palette.error }]} />
        </Pressable>
      ) : (
        <Pressable
          style={[styles.sendInline, { backgroundColor: props.canSend ? palette.brand : palette.surfaceMuted }]}
          onPress={props.onSubmit}
          disabled={!props.canSend}
        >
          <AppIcon name="chevron-right" color={props.canSend ? '#FFFFFF' : palette.textSecondary} size={18} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  inputShell: {
    flexDirection: 'row', alignItems: 'flex-end',
    marginHorizontal: spacing.x3, borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.x2,
  },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingVertical: spacing.x2, fontSize: 15, textAlignVertical: 'center' },
  sendInline: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginVertical: 5 },
  stopSquare: { width: 12, height: 12, borderRadius: 3 },
})
