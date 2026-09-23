/**
 * 工作区作品（产物）浏览：fs.entries 列目录/文件 → 点文件经 preview 帧拉取 → 全屏预览。
 *
 * v1 渲染策略：全部走 WebView data URI（html 原样运行、图片/文本直接展示），
 * 单文件产物（如 agent 生成的游戏/页面）是主场景；多文件相对引用留 v2（本机微 HTTP）。
 */

import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";
import SyntaxHighlighter from "react-native-syntax-highlighter";
import { docco } from "react-syntax-highlighter/styles/hljs";
import atomOneDark from "react-syntax-highlighter/styles/hljs/atom-one-dark";
import { ChevronLeft, Eye, FileText, Folder, X } from "lucide-react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { base64ToText } from "@/lib/base64";
import { previewKind } from "@/lib/preview-kind";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Sheet } from "@/design-system/Sheet";
import { useDshStore } from "@/state/dshStore";

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
  const insets = useSafeAreaInsets();
  const background = useCSSVariable("--color-background") as string | undefined;
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
        <View className="mb-2 flex-row items-center gap-2">
          {parent !== null && (
            <Pressable
              className="flex-row items-center gap-0.5"
              onPress={() => setCwd(parent)}
              hitSlop={8}
            >
              <Icon as={ChevronLeft} className="text-muted-foreground size-4" />
              <Text className="text-muted-foreground text-sm">上一级</Text>
            </Pressable>
          )}
          <Text
            className="text-muted-foreground flex-1 font-mono text-[11px]"
            numberOfLines={1}
          >
            {cwd}
          </Text>
        </View>
        {previewLoading && (
          <Text className="text-muted-foreground mb-2 text-[13px]">
            拉取中…
          </Text>
        )}
        {loading && (
          <Text className="text-muted-foreground mb-2 text-[13px]">
            读取目录…
          </Text>
        )}
        {error !== null && (
          <Text className="text-destructive mb-2 text-[13px]">{error}</Text>
        )}
        {!loading && entries.length === 0 && (
          <Text className="text-muted-foreground mb-2 text-[13px]">
            这里还没有文件——让 agent 在这个工作区做点什么，产物会出现在这里。
          </Text>
        )}
        <ScrollView>
          {entries.length > 0 && (
            <View className="bg-card border-border overflow-hidden rounded-xl border">
              {entries.map((entry, index) => (
                <React.Fragment key={entry.path}>
                  {index > 0 && <View className="bg-border h-px w-full" />}
                  <Pressable
                    className="active:bg-accent flex-row items-center gap-3 px-4 py-3"
                    onPress={() => openEntry(entry)}
                  >
                    <View className="bg-muted h-8 w-8 items-center justify-center rounded-md">
                      <Icon
                        as={entry.type === 'directory' ? Folder : FileText}
                        className="text-muted-foreground size-4"
                      />
                    </View>
                    <Text className="text-foreground flex-1 text-sm font-medium" numberOfLines={1}>
                      {entry.name}
                    </Text>
                    {entry.type === 'file' && PREVIEWABLE_EXT.test(entry.name) && (
                      <Icon as={Eye} className="text-muted-foreground size-4" />
                    )}
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          )}
        </ScrollView>
      </Sheet>

      {/* 全屏预览：data URI 直载 WebView（html 运行 / 图片与文本展示） */}
      <Modal
        visible={preview !== null}
        animationType="slide"
        onRequestClose={() => setPreview(null)}
      >
        <View
          className="bg-background flex-1"
          style={{
            // RN Modal 渲染在全局 SafeAreaView 之外，需自行避让刘海/手势条
            paddingTop: insets.top + 4,
            paddingBottom: insets.bottom,
          }}
        >
          <View
            className="bg-card border-border flex-row items-center border-b px-3 py-2"
          >
            <Text
              className="text-foreground flex-1 text-sm font-semibold"
              numberOfLines={1}
            >
              {preview?.name ?? ""}
            </Text>
            <Pressable
              className="p-1"
              onPress={() => setPreview(null)}
              hitSlop={8}
              accessibilityLabel="关闭预览"
            >
              <Icon as={X} className="text-foreground size-5" />
            </Pressable>
          </View>
          {preview !== null && (
            <PreviewBody preview={preview} background={background} />
          )}
        </View>
      </Modal>
    </>
  )
}

function PreviewBody({
  preview,
  background,
}: Readonly<{ preview: PreviewState; background: string | undefined }>) {
  const { theme } = useUniwind();
  const [foreground, muted, border, primary, mutedBg] = useCSSVariable([
    "--color-foreground",
    "--color-muted-foreground",
    "--color-border",
    "--color-primary",
    "--color-muted",
  ]) as [string, string, string, string, string];
  const kind = previewKind(preview.name, preview.mime);
  const text = useMemo(
    () => (kind === "html" || kind === "image" ? "" : base64ToText(preview.base64)),
    [kind, preview.base64],
  );

  if (kind === "html" || kind === "image") {
    return (
      <WebView
        source={{ uri: `data:${preview.mime};base64,${preview.base64}` }}
        style={{ flex: 1, backgroundColor: background }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileRead={false}
      />
    );
  }

  if (kind === "markdown") {
    return (
      <ScrollView contentContainerClassName="p-4">
        <Markdown style={markdownStyle({ foreground, muted, border, primary, codeBg: mutedBg })}>
          {text}
        </Markdown>
      </ScrollView>
    );
  }

  if (kind === "code") {
    const ext = preview.name.split(".").pop()!.toLowerCase();
    return (
      <ScrollView contentContainerClassName="p-3">
        <SyntaxHighlighter
          language={ext}
          style={theme === "dark" ? atomOneDark : docco}
          highlighter="hljs"
          fontSize={12}
         {...({ PreTag: View, CodeTag: View } as Record<string, unknown>)}>
          {text}
        </SyntaxHighlighter>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerClassName="p-4">
      <Text className="text-foreground font-mono text-xs leading-[18px]">{text}</Text>
    </ScrollView>
  );
}

function markdownStyle(c: Readonly<{ foreground: string; muted: string; border: string; primary: string; codeBg: string }>) {
  return {
    body: { color: c.foreground, fontSize: 15, lineHeight: 24 },
    heading1: { color: c.foreground, fontSize: 20, fontWeight: "700" as const, marginVertical: 8 },
    heading2: { color: c.foreground, fontSize: 18, fontWeight: "700" as const, marginVertical: 6 },
    heading3: { color: c.foreground, fontSize: 16, fontWeight: "600" as const, marginVertical: 4 },
    strong: { color: c.foreground, fontWeight: "700" as const },
    link: { color: c.primary },
    code_inline: {
      backgroundColor: c.codeBg,
      color: c.foreground,
      fontFamily: "Menlo",
      fontSize: 13,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    fence: {
      backgroundColor: c.codeBg,
      borderColor: c.border,
      borderWidth: 1,
      fontFamily: "Menlo",
      fontSize: 12,
      color: c.foreground,
      borderRadius: 8,
      padding: 10,
    },
    code_block: { backgroundColor: c.codeBg, borderRadius: 8, padding: 10 },
    blockquote: {
      backgroundColor: c.codeBg,
      borderLeftColor: c.primary,
      borderLeftWidth: 3,
      borderRadius: 4,
      paddingLeft: 8,
      paddingVertical: 4,
    },
    bullet_list_icon: { color: c.muted },
    ordered_list_icon: { color: c.muted },
    hr: { backgroundColor: c.border, height: 1, marginVertical: 8 },
  };
}
