/**
 * 输入区（对齐豆包/ChatGPT 范式）：
 *   上：胶囊工具行（命令 / 模式 / 拍照 / 相册）
 *   中：大圆角输入区（附件缩略图 + 多行 + 发送/停止）
 *   下：状态行（权限徽章 · 模型 · 累计 tokens）
 * 输入 "/" 触发内联命令联想。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppIcon, IconName } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'workspace-write': '工作区可写',
  'danger-full-access': '完全访问',
  'read-only': '只读',
  custom: '自定义',
}

const PRESET_LABELS: Readonly<Record<string, string>> = {
  standard: '标准',
  code: '代码编排',
  minimal: '极简',
  cordis: 'Cordis',
}

export interface PendingImage {
  readonly base64: string
  readonly mediaType: string
  readonly uri: string
  readonly uploading: boolean
  /** 上传完成后的 dsh attachment ref */
  readonly ref?: unknown
}

export function ComposerBar(props: Readonly<{
  onOpenMenu: (tab: 'permission' | 'model' | 'preset' | 'commands') => void;
}>): React.JSX.Element | null {
  const { palette } = usePreferences()
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const sendMessage = useDshStore((s) => s.sendMessage)
  const stopTurn = useDshStore((s) => s.stopTurn)
  const uploadImage = useDshStore((s) => s.uploadImage)
  const listCommands = useDshStore((s) => s.listCommands)
  const running = useDshStore((s) => s.sessionView.agentStatus === 'running')
  const permission = useDshStore((s) => s.sessionView.permissionCurrent)
  const totalUsage = useDshStore((s) => s.sessionView.totalUsage)
  const newSessionDefaults = useDshStore((s) => s.newSessionDefaults)
  const newSessionPreset = useDshStore((s) => s.newSessionPreset)
  const [commandsCache, setCommandsCache] = useState<readonly { name: string; description: string }[]>([])

  useEffect(() => {
    void listCommands().then(setCommandsCache)
  }, [listCommands])

  // "/" 内联命令联想
  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.slice(1).toLowerCase() : null
  const suggestions = useMemo(() => {
    if (slashQuery === null) return []
    return commandsCache.filter((c) => c.name.startsWith(slashQuery)).slice(0, 6)
  }, [slashQuery, commandsCache])

  const addImages = async (mode: 'camera' | 'library'): Promise<void> => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
      allowsMultipleSelection: mode === 'library',
    }
    const result = mode === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options)
    if (result.canceled) return
    for (const asset of result.assets) {
      const mediaType = asset.mimeType ?? 'image/jpeg'
      const base64 = asset.base64 ?? ''
      const entry: PendingImage = { base64, mediaType, uri: asset.uri, uploading: true }
      setImages((prev) => [...prev, entry])
      void uploadImage(base64, mediaType, asset.fileName ?? undefined).then((ref) => {
        setImages((prev) => prev.map((img) => (img === entry ? { ...img, uploading: false, ...(ref !== null ? { ref } : {}) } : img)))
      })
    }
  }

  const submit = (): void => {
    const ready = images.filter((img) => !img.uploading && img.ref !== undefined)
    const value = text.trim()
    if (value.length === 0 && ready.length === 0) return
    setText('')
    setImages([])
    void sendMessage(value, ready.map((img) => img.ref))
  }

  const canSend = (text.trim().length > 0 || images.some((img) => !img.uploading && img.ref !== undefined))
    && !images.some((img) => img.uploading)
  const modelLabel = newSessionDefaults !== null ? newSessionDefaults.model.replace('deepseek-', '') : 'v4-flash'
  const presetLabel = PRESET_LABELS[newSessionPreset.length > 0 ? newSessionPreset : 'standard'] ?? newSessionPreset

  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
      {/* 内联命令联想 */}
      {suggestions.length > 0 && (
        <View style={[styles.suggestBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {suggestions.map((cmd) => (
            <Pressable
              key={cmd.name}
              style={({ pressed }) => [styles.suggestRow, pressed && { backgroundColor: palette.surfaceMuted }]}
              onPress={() => setText(`/${cmd.name} `)}
            >
              <Text style={[styles.suggestName, { color: palette.brand, fontFamily: 'Menlo' }]}>/{cmd.name}</Text>
              <Text style={[styles.suggestDesc, { color: palette.textSecondary }]} numberOfLines={1}>{cmd.description}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 胶囊工具行 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        <Pill icon="chevron-right" label="命令" onPress={() => props.onOpenMenu('commands')} />
        <Pill icon="palette" label={`模式 · ${presetLabel}`} onPress={() => props.onOpenMenu('preset')} />
        <Pill icon="image" label="相册" onPress={() => void addImages('library')} />
        <Pill icon="plus" label="拍照" onPress={() => void addImages('camera')} />
      </ScrollView>

      {/* 附件缩略图 */}
      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
          {images.map((img, i) => (
            <View key={i} style={[styles.thumbWrap, { borderColor: palette.border }]}>
              <Image source={{ uri: img.uri }} style={styles.thumb} />
              {img.uploading && <View style={[styles.thumbOverlay, { backgroundColor: palette.scrim }]}><Text style={styles.thumbText}>…</Text></View>}
              <Pressable style={styles.thumbRemove} onPress={() => setImages((prev) => prev.filter((x) => x !== img))}>
                <AppIcon name="close" color="#FFFFFF" size={12} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 输入行 */}
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { color: palette.text, backgroundColor: palette.surfaceMuted }]}
          placeholder="发送消息…（/ 唤起命令）"
          placeholderTextColor={palette.textSecondary}
          value={text}
          onChangeText={setText}
          multiline
        />
        {running ? (
          <Pressable style={[styles.send, { backgroundColor: palette.surfaceMuted }]} onPress={() => void stopTurn()}>
            <View style={[styles.stopSquare, { backgroundColor: palette.error }]} />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.send, { backgroundColor: canSend ? palette.brand : palette.surfaceMuted }]}
            onPress={submit}
            disabled={!canSend}
          >
            <AppIcon name="chevron-right" color={canSend ? '#FFFFFF' : palette.textSecondary} size={20} />
          </Pressable>
        )}
      </View>

      {/* 状态行 */}
      <Pressable style={styles.statusRow} onPress={() => props.onOpenMenu('permission')}>
        <View style={[styles.statusDot, { backgroundColor: permission === 'danger-full-access' ? palette.error : permission === 'read-only' ? palette.textSecondary : palette.success }]} />
        <Text style={[styles.statusText, { color: palette.textSecondary }]}>
          {permission !== null ? (PERMISSION_LABELS[permission] ?? permission) : '权限'} · {modelLabel}
          {totalUsage.input > 0 || totalUsage.output > 0 ? ` · ${compact(totalUsage.input)} in / ${compact(totalUsage.output)} out` : ''}
        </Text>
        <AppIcon name="chevron-right" color={palette.textSecondary} size={12} />
      </Pressable>
    </View>
  )
}

function Pill(props: Readonly<{ icon: IconName; label: string; onPress: () => void }>): React.JSX.Element {
  const { palette } = usePreferences()
  return (
    <Pressable
      style={({ pressed }) => [styles.pill, { backgroundColor: palette.surfaceMuted }, pressed && { opacity: 0.7 }]}
      onPress={props.onPress}
    >
      <AppIcon name={props.icon} color={palette.brand} size={13} />
      <Text style={[styles.pillText, { color: palette.text }]}>{props.label}</Text>
    </Pressable>
  )
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.x2, paddingBottom: spacing.x2, gap: spacing.x2 },
  suggestBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, marginBottom: spacing.x1, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2 },
  suggestName: { fontSize: 13 },
  suggestDesc: { flex: 1, fontSize: 12 },
  pillRow: { flexDirection: 'row', gap: spacing.x2, paddingHorizontal: spacing.x3 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.x1, paddingHorizontal: spacing.x3, paddingVertical: spacing.x1, borderRadius: radii.round },
  pillText: { fontSize: 13 },
  thumbRow: { flexDirection: 'row', gap: spacing.x2, paddingHorizontal: spacing.x3 },
  thumbWrap: { width: 56, height: 56, borderRadius: radii.control, borderWidth: 1, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  thumbOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  thumbText: { color: '#FFFFFF', fontSize: 12 },
  thumbRemove: { position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.x2, paddingHorizontal: spacing.x3 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: radii.card, padding: spacing.x2, paddingTop: spacing.x2, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 14, height: 14, borderRadius: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x1, paddingHorizontal: spacing.x4, paddingVertical: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, flex: 1 },
})
