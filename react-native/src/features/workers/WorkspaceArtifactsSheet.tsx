/**
 * 工作区作品（产物）浏览：fs.entries 列目录/文件 → 点文件经 preview 帧拉取 → 全屏预览。
 *
 * v1 渲染策略：全部走 WebView data URI（html 原样运行、图片/文本直接展示），
 * 单文件产物（如 agent 生成的游戏/页面）是主场景；多文件相对引用留 v2（本机微 HTTP）。
 */

import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { AppIcon } from "../../design-system/AppIcon";
import { Sheet } from "../../design-system/Sheet";
import { usePreferences } from "../../preferences/PreferencesProvider";
import { useDshStore } from "../../state/dshStore";
import { spacing, radii } from "../../theme/tokens";

interface Entry {
  readonly name: string
  readonly path: string
  readonly type: 'file' | 'directory'
}

/** 可预览扩展名（worker 白名单的客户端镜像，未命中只提示不可预览） */
const PREVIEWABLE_EXT =
  /\.(html?|css|mjs|js|json|txt|md|csv|png|jpe?g|gif|webp|svg|ico|mp3|wav|wasm)$/i

interface PreviewState {
  readonly name: string
  readonly mime: string
  readonly base64: string
}

export function WorkspaceArtifactsSheet({
  visible,
  workspace,
  onClose,
}: Readonly<{
  visible: boolean
  workspace: { title: string; path: string } | null
  onClose: () => void
}>) {
  const { palette } = usePreferences();
  const listEntries = useDshStore((s) => s.listEntries);
  const previewFile = useDshStore((s) => s.previewFile);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!visible || workspace === null) return
    setCwd(workspace.path)
  }, [visible, workspace])

  useEffect(() => {
    if (cwd.length === 0) return
    setLoading(true)
    setError(null)
    void listEntries(cwd).then((list) => {
      setLoading(false)
      setEntries(list)
    })
  }, [cwd, listEntries])

  const openEntry = (entry: Entry): void => {
    if (entry.type === 'directory') {
      setCwd(entry.path)
      return
    }
    if (!PREVIEWABLE_EXT.test(entry.name)) {
      setError(`暂不支持预览 ${entry.name}（类型不在白名单）`)
      return
    }
    setPreviewLoading(true)
    setError(null)
    void previewFile(entry.path)
      .then((r) => {
        setPreviewLoading(false)
        setPreview({ name: entry.name, mime: r.mime, base64: r.base64 })
      })
      .catch((e: unknown) => {
        setPreviewLoading(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  const isRoot = workspace !== null && cwd === workspace.path
  const parent = (() => {
    if (isRoot || workspace === null) return null
    // 只在工作区内逐级返回，不出根
    if (cwd.startsWith(workspace.path + '/')) {
      const up = cwd.slice(0, cwd.lastIndexOf('/'))
      return up.startsWith(workspace.path) ? up : workspace.path
    }
    return workspace.path
  })()

  return (
    <>
      <Sheet
        visible={visible}
        title={workspace?.title ?? "作品"}
        onClose={onClose}
        scrollable
        snapPoints={["70%", "92%"]}
      >
        <View style={styles.breadcrumbRow}>
          {parent !== null && (
            <Pressable
              style={styles.upButton}
              onPress={() => setCwd(parent)}
              hitSlop={8}
            >
              <AppIcon name="chevron-left" color={palette.brand} size={14} />
              <Text style={[styles.upText, { color: palette.brand }]}>上一级</Text>
            </Pressable>
          )}
          <Text
            style={[styles.breadcrumb, { color: palette.textSecondary }]}
            numberOfLines={1}
          >
            {cwd}
          </Text>
        </View>
        {previewLoading && (
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            拉取中…
          </Text>
        )}
        {loading && (
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            读取目录…
          </Text>
        )}
        {error !== null && (
          <Text style={[styles.hint, { color: palette.error }]}>{error}</Text>
        )}
        {!loading && entries.length === 0 && (
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            这里还没有文件——让 agent 在这个工作区做点什么，产物会出现在这里。
          </Text>
        )}
        <ScrollView style={styles.list}>
          {entries.map((entry) => (
            <Pressable
              key={entry.path}
              style={[styles.row, { borderColor: palette.border }]}
              onPress={() => openEntry(entry)}
            >
              <AppIcon
                name={entry.type === 'directory' ? 'folder' : 'file-text'}
                color={palette.textSecondary}
                size={16}
              />
              <Text
                style={[styles.rowName, { color: palette.text }]}
                numberOfLines={1}
              >
                {entry.name}
              </Text>
              {entry.type === 'file' && PREVIEWABLE_EXT.test(entry.name) && (
                <AppIcon name="eye" color={palette.brand} size={14} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>

      {/* 全屏预览：data URI 直载 WebView（html 运行 / 图片与文本展示） */}
      <Modal
        visible={preview !== null}
        animationType="slide"
        onRequestClose={() => setPreview(null)}
      >
        <View style={[styles.previewShell, { backgroundColor: palette.background }]}>
          <View
            style={[
              styles.previewBar,
              {
                backgroundColor: palette.surface,
                borderBottomColor: palette.border,
              },
            ]}
          >
            <Text
              style={[styles.previewTitle, { color: palette.text }]}
              numberOfLines={1}
            >
              {preview?.name ?? ""}
            </Text>
            <Pressable
              style={styles.previewClose}
              onPress={() => setPreview(null)}
              hitSlop={8}
              accessibilityLabel="关闭预览"
            >
              <AppIcon name="close" color={palette.text} size={20} />
            </Pressable>
          </View>
          {preview !== null && (
            <WebView
              source={{ uri: `data:${preview.mime};base64,${preview.base64}` }}
              style={{ flex: 1, backgroundColor: palette.background }}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled={false}
              allowFileRead={false}
            />
          )}
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  breadcrumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  upButton: { flexDirection: "row", alignItems: "center", gap: 2 },
  upText: { fontSize: 13 },
  breadcrumb: { flex: 1, fontSize: 11, fontFamily: "Menlo" },
  hint: { fontSize: 13, marginBottom: spacing.x2 },
  list: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.control,
    padding: spacing.x2,
    marginBottom: spacing.x1,
  },
  rowName: { flex: 1, fontSize: 14 },
  previewShell: { flex: 1, paddingTop: spacing.x6 },
  previewBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewTitle: { flex: 1, fontSize: 15 },
  previewClose: { padding: spacing.x1 },
})
