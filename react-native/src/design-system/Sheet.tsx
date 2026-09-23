/**
 * 通用 Bottom Sheet（@gorhom/bottom-sheet）：拖拽把手关闭、snap 停靠、
 * 键盘避让（extend）。RNR 迁移后配色改由 Uniwind CSS 变量驱动。
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';
import { Text } from '@/components/ui/text';
import { AppIcon } from './AppIcon';

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
  const insets = useSafeAreaInsets()
  const ref = useRef<BottomSheetModal>(null)
  const [surface, border, muted] = useCSSVariable([
    '--color-card',
    '--color-border',
    '--color-muted-foreground',
  ]) as [string, string, string]

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
    <View className="border-border/60 mb-2 flex-row items-center justify-between border-b pb-2">
      <Text className="text-base font-bold">{props.title}</Text>
      <Pressable onPress={close} hitSlop={10}>
        <AppIcon name="close" color={muted} size={18} />
      </Pressable>
    </View>
  )
  const contentStyle = { paddingHorizontal: 16, paddingBottom: 24 + insets.bottom }

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={(bp) => (
        <BottomSheetBackdrop {...bp} opacity={0.5} appearsOnIndex={0} disappearsOnIndex={-1} onPress={close} />
      )}
      handleIndicatorStyle={{ backgroundColor: border, width: 40 }}
      backgroundStyle={{ backgroundColor: surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      // extend：键盘弹出时弹层伸到最高档并压缩可视内容区，输入不被覆盖
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      onDismiss={props.onClose}
    >
      {props.scrollable === true ? (
        <BottomSheetScrollView contentContainerStyle={contentStyle}>
          {header}
          {props.children}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView style={contentStyle}>
          {header}
          {props.children}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  )
}
