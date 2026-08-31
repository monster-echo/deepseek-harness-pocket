/**
 * 通用 Bottom Sheet（@gorhom/bottom-sheet）：拖拽把手关闭、snap 停靠、
 * 键盘避让（extend）。半屏弹层统一用它；全屏页（目录选择器）与
 * 居中确认卡仍用 RN Modal。
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import { AppIcon } from './AppIcon';
import { usePreferences } from '../preferences/PreferencesProvider';
import { spacing } from '../theme/tokens';

export interface SheetProps {
  readonly visible: boolean
  readonly title: string
  readonly onClose: () => void
  /** 内容高度自适应需 fixed 快照；默认 60%/90% 两档停靠 */
  readonly snapPoints?: readonly string[]
  readonly scrollable?: boolean
  readonly children: React.ReactNode
}

export function Sheet(props: Readonly<SheetProps>): React.JSX.Element {
  const { palette } = usePreferences()
  const insets = useSafeAreaInsets()
  const ref = useRef<BottomSheetModal>(null)

  useEffect(() => {
    if (props.visible) ref.current?.present()
    // 父态程序化关闭（选中项后 setSheet(null)）也要真正收起弹层，
    // 否则选择完成 sheet 仍留在屏幕上。
    else ref.current?.dismiss()
  }, [props.visible])

  const close = (): void => {
    ref.current?.dismiss()
  }

  const snapPoints = props.snapPoints !== undefined ? [...props.snapPoints] : ['60%', '90%']
  const header = (
    <View style={[styles.header, { borderBottomColor: palette.border }]}>
      <Text style={[styles.title, { color: palette.text }]}>{props.title}</Text>
      <Pressable onPress={close} hitSlop={10}>
        <AppIcon name="close" color={palette.textSecondary} size={18} />
      </Pressable>
    </View>
  )

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={(bp) => (
        <BottomSheetBackdrop {...bp} opacity={0.5} appearsOnIndex={0} disappearsOnIndex={-1} onPress={close} />
      )}
      handleIndicatorStyle={{ backgroundColor: palette.border, width: 40 }}
      backgroundStyle={{ backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      // extend：键盘弹出时弹层伸到最高档并压缩可视内容区，输入不被覆盖
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      onDismiss={props.onClose}
    >
      {props.scrollable === true ? (
        <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.x6 + insets.bottom }]}>
          {header}
          {props.children}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView style={[styles.content, { paddingBottom: spacing.x6 + insets.bottom }]}>
          {header}
          {props.children}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.x4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.x2, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: spacing.x2 },
  title: { fontSize: 16, fontWeight: '700' },
})
