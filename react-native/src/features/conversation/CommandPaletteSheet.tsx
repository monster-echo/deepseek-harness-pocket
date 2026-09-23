/**
 * 快捷命令 Sheet：单层命令列表，点按即以 /name 直接发送（免模型回合）。
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { Sheet } from '../../design-system/Sheet';
import { AppIcon } from '../../design-system/AppIcon';
import { Text } from '@/components/ui/text';
import { useDshStore } from '../../state/dshStore';

export function CommandPaletteSheet(props: Readonly<{ visible: boolean; onClose: () => void; onCommand: (name: string) => void; onPickImage?: () => void }>): React.JSX.Element {
  const muted = useCSSVariable('--color-muted-foreground') as string | undefined;
  const onPickImage = props.onPickImage
  const [commands, setCommands] = useState<readonly { name: string; description: string }[]>([])
  const listCommands = useDshStore((s) => s.listCommands)
  const notice = useDshStore((s) => s.notice)

  useEffect(() => {
    if (!props.visible) return
    void listCommands().then(setCommands)
  }, [props.visible, listCommands])

  const run = (name: string): void => {
    props.onClose()
    props.onCommand(name)
  }

  return (
    <Sheet visible={props.visible} title="快捷命令" onClose={props.onClose} scrollable snapPoints={['50%', '85%']}>
      <ScrollView className="max-h-[380px]">
        {onPickImage !== undefined && (
          <Pressable
            className="border-border active:bg-muted mb-2 flex-row items-center gap-2 rounded-xl border p-3"
            onPress={() => {
              props.onClose()
              onPickImage()
            }}
          >
            <View className="flex-1">
              <Text className="text-foreground text-sm font-semibold">添加图片</Text>
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>从相册选取，随消息发送</Text>
            </View>
            <AppIcon name="paperclip" color={muted} size={14} />
          </Pressable>
        )}
        {commands.map((cmd) => (
          <Pressable
            key={cmd.name}
            className="border-border active:bg-muted mb-2 flex-row items-center gap-2 rounded-xl border p-3"
            onPress={() => run(cmd.name)}
          >
            <View className="flex-1">
              <Text className="text-foreground font-mono text-sm font-semibold">/{cmd.name}</Text>
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>{cmd.description}</Text>
            </View>
            <AppIcon name="chevron-right" color={muted} size={14} />
          </Pressable>
        ))}
        {commands.length === 0 && (
          <Text className="text-muted-foreground p-3 text-center text-[13px]">
            {notice ?? '命令目录为空（需活跃会话）'}
          </Text>
        )}
      </ScrollView>
    </Sheet>
  )
}
