/**
 * 会话时间线（展示模型对齐 dsh Web GUI）：
 *   - 用户右对齐气泡；assistant blocks 混排（text 正文 + Think 折叠行）
 *   - 工具行：状态点 + 变体名 · 单行摘要，点按展开 IN/OUT
 *   - 回合尾：completed 细线 / error 红 / max-tokens 琥珀 / stopped 标记
 *   - 审批与提问接管 composer 上方（对齐 dsh ApprovalPanel 行为：仅允许一次/拒绝）
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import SyntaxHighlighter from "react-native-syntax-highlighter";
import { docco } from "react-syntax-highlighter/styles/hljs";
import atomOneDark from "react-syntax-highlighter/styles/hljs/atom-one-dark";
import * as Clipboard from "expo-clipboard";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { AppIcon, IconName } from "../../design-system/AppIcon";
import { Sheet } from "../../design-system/Sheet";
import { usePreferences } from "../../preferences/PreferencesProvider";
import { useDshStore } from "../../state/dshStore";
import { spacing, radii } from "../../theme/tokens";
import type { AssistantBlock, TimelineItem, ToolStatus } from "./reducer";
import { splitDsml, cutAtDsmlStart, type DsmlToolCall } from "./dsml";
import { Composer } from "./Composer";

export function ConversationScreen() {
  const { palette, textScale } = usePreferences();
  // 字号统一受「字体大小」设置驱动（与 theme/styles.ts 的 applyTheme 同套路：
  // 渲染期重建模块级样式表，子组件在本次渲染中读到新样式）
  styles = useMemo(() => makeStyles(textScale), [textScale]);
  sheetStyles = useMemo(() => makeSheetStyles(textScale), [textScale]);
  const view = useDshStore((s) => s.sessionView);
  const notice = useDshStore((s) => s.notice);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const sessionLoading = useDshStore((s) => s.sessionLoading);
  const serverRequests = useDshStore((s) => s.serverRequests);
  const scrollRef = useRef<ScrollView>(null);
  const [actionTarget, setActionTarget] = useState<TimelineItem | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [view.items.length]);

  if (activeSessionId === null) {
    // 对齐 dsh Web 新建会话页：居中大输入区（首条消息即建会话）
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={[styles.containerSession]}>
          <Composer mode="new" />
        </View>
      </View>
    );
  }

  if (sessionLoading && view.items.length === 0) {
    // 快照在途：明确加载态，避免「点了没反应」的观感
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={styles.sessionLoading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.sessionLoadingText, { color: palette.textSecondary }]}>
            正在加载会话…
          </Text>
        </View>
      </View>
    );
  }

  const pending = serverRequests[0];

  return (
    /* 键盘避让：SDK 57 edge-to-edge 下 Android adjustResize 失效、iOS 无原生避让，
       会话屏根部包 KAV（双平台 padding），保证 composer 始终在键盘上方 */
    <KeyboardAvoidingView behavior="padding" style={styles.container}>
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {notice !== null && (
        <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
          <Text style={[styles.noticeText, { color: palette.warning }]}>
            {notice}
          </Text>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.timeline}
        contentContainerStyle={{
          padding: spacing.x3,
          gap: spacing.x2,
          paddingBottom: spacing.x4,
        }}
      >
        {view.items.map((item) => (
          <TimelineRow
            key={item.key}
            item={item}
            onLongPress={setActionTarget}
          />
        ))}
      </ScrollView>
      <MessageActionSheet
        target={actionTarget}
        onClose={() => setActionTarget(null)}
      />
      {/* 审批/提问接管输入区（dsh ApprovalPanel 模式）；否则升级版输入区 */}
      {pending !== undefined ? (
        <ServerRequestCard request={pending} />
      ) : (
        <Composer mode="session" />
      )}
      {/* 运行统计已收纳进 Composer 的上下文用量 Sheet */}
    </View>
    </KeyboardAvoidingView>
  );
}

// ---------- 时间线行 ----------

function TimelineRow({
  item,
  onLongPress,
}: Readonly<{
  item: TimelineItem;
  onLongPress: (item: TimelineItem) => void;
}>) {
  if (item.kind === "user")
    return <UserRow item={item} onLongPress={onLongPress} />;
  if (item.kind === "assistant")
    return <AssistantRow item={item} onLongPress={onLongPress} />;
  if (item.kind === "tool") return <ToolRow item={item} />;
  if (item.kind === "compaction") return <CompactionRow item={item} />;
  if (item.kind === "contextInjection")
    return <ContextInjectionRow item={item} />;
  return <TurnEndRow item={item} />;
}

/** 底部累计统计行（对齐 dsh Web stats：轮/步/LLM/工具/首token/tok/s/缓存/输入输出）。 */
function UserRow({
  item,
  onLongPress,
}: Readonly<{
  item: TimelineItem;
  onLongPress: (item: TimelineItem) => void;
}>) {
  const { palette } = usePreferences();
  return (
    <View style={styles.userRow}>
      <Pressable
        onLongPress={() => onLongPress(item)}
        delayLongPress={350}
        style={[styles.userBubble, { backgroundColor: palette.brand }]}
      >
        <Text numberOfLines={1} style={[styles.userText, { color: "#FFFFFF" }]}>
          {item.text}
        </Text>
      </Pressable>
    </View>
  );
}

/** 上下文注入（对齐 dsh ContextInjectionRow）：非 user 来源的折叠行，标题 + 来源 + 摘要 + 展开 body（snapshot 展示 sections 分段）。 */
function ContextInjectionRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences();
  const [open, setOpen] = useState(false);
  const label = item.contextForm === "recall" ? "上下文召回" : "上下文注入";
  const summary =
    item.summary !== undefined && item.summary.length > 0
      ? item.summary
      : item.text !== undefined && item.text.length > 0
        ? (item.text.split("\n")[0] ?? "")
        : "";
  return (
    <Pressable
      style={[
        styles.ciRow,
        { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
      ]}
      onPress={() => setOpen(!open)}
    >
      <AppIcon name="globe" color={palette.textSecondary} size={14} />
      <View style={{ flex: 1 }}>
        <View style={styles.ciHeader}>
          <Text style={[styles.ciTitle, { color: palette.text }]}>{label}</Text>
          {item.producer !== undefined && (
            <Text
              style={[styles.ciProducer, { color: palette.textSecondary }]}
              numberOfLines={1}
            >
              {item.producer}
            </Text>
          )}
        </View>
        {summary.length > 0 && (
          <Text
            style={[styles.ciSummary, { color: palette.textSecondary }]}
            numberOfLines={open ? undefined : 1}
          >
            {summary}
          </Text>
        )}
        {open && (
          <View style={styles.ciBody}>
            {item.sections !== undefined && item.sections.length > 0
              ? item.sections.map((s, i) => (
                  <View key={i} style={styles.ciSection}>
                    <Text
                      style={[
                        styles.ciSectionName,
                        { color: palette.brand, fontFamily: "Menlo" },
                      ]}
                    >
                      {s.name}
                    </Text>
                    <Text
                      style={[
                        styles.ciSectionText,
                        { color: palette.textSecondary },
                      ]}
                    >
                      {s.text}
                    </Text>
                  </View>
                ))
              : item.text !== undefined &&
                item.text.length > 0 && (
                  <Text
                    style={[
                      styles.ciSectionText,
                      { color: palette.textSecondary },
                    ]}
                  >
                    {item.text}
                  </Text>
                )}
          </View>
        )}
      </View>
      <AppIcon name="chevron-right" color={palette.textSecondary} size={14} />
    </Pressable>
  );
}

function AssistantRow({
  item,
  onLongPress,
}: Readonly<{
  item: TimelineItem;
  onLongPress: (item: TimelineItem) => void;
}>) {
  const { palette } = usePreferences();
  const blocks = item.blocks ?? [];
  return (
    <Pressable
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      style={styles.assistantBubble}
    >
      {blocks.map((block, i) => (
        <AssistantBlockView
          key={i}
          block={block}
          streaming={item.streaming === true}
        />
      ))}
      {blocks.length === 0 && item.streaming === true && (
        <Text style={[styles.thinkSummary, { color: palette.textSecondary }]}>
          思考中…
        </Text>
      )}
      {item.stopped === true && (
        <Text style={[styles.stoppedMark, { color: palette.warning }]}>
          已停止
        </Text>
      )}
      {item.usage !== undefined && (
        <Text style={[styles.usageLine, { color: palette.textSecondary }]}>
          {item.usage.input} in · {item.usage.output} out
        </Text>
      )}
    </Pressable>
  );
}

/** text → 正文（流式纯文本，定稿 Markdown）；reasoning → Think 折叠行。 */
function AssistantBlockView({
  block,
  streaming,
}: Readonly<{ block: AssistantBlock; streaming: boolean }>) {
  const { palette, dark, textScale } = usePreferences();
  const [open, setOpen] = useState(false);
  if (block.type === "text") {
    if (streaming) {
      return (
        <Text style={[styles.assistantText, { color: palette.text }]}>
          {cutAtDsmlStart(block.text)}
          {" ▍"}
        </Text>
      );
    }
    const { prose, calls } = splitDsml(block.text);
    if (calls.length > 0) {
      return (
        <View style={styles.dsmlGroup}>
          {prose.length > 0 && (
            <Markdown
              style={markdownStyle(palette, textScale)}
              rules={markdownRules(palette, dark, textScale)}
            >
              {prose}
            </Markdown>
          )}
          {calls.map((call, i) => (
            <DsmlToolCard key={i} call={call} />
          ))}
          <Text style={[styles.dsmlHint, { color: palette.textSecondary }]}>
            以上工具调用由模型以文本协议输出、未被 dsh 执行（上游 adapter 未解析
            DSML）
          </Text>
        </View>
      );
    }
    return (
      <Markdown
        style={markdownStyle(palette, textScale)}
        rules={markdownRules(palette, dark, textScale)}
      >
        {block.text}
      </Markdown>
    );
  }
  const lines = block.text.split("\n").filter((l) => l.trim().length > 0);
  const summary = streaming
    ? (lines[lines.length - 1] ?? "")
    : (lines[0] ?? "");
  return (
    <Pressable
      style={[styles.thinkRow, { backgroundColor: palette.surfaceMuted }]}
      onPress={() => setOpen(!open)}
    >
      <View style={styles.thinkHead}>
        <AppIcon name="chevron-right" color={palette.textSecondary} size={14} />
        <Text style={[styles.thinkLabel, { color: palette.textSecondary }]}>
          思考
        </Text>
        {!open && (
          <Text
            style={[styles.thinkSummary, { color: palette.textSecondary }]}
            numberOfLines={1}
          >
            {summary.length > 0 ? summary : `${block.text.length} 字`}
          </Text>
        )}
      </View>
      {open && (
        <Text style={[styles.thinkBody, { color: palette.textSecondary }]}>
          {block.text}
        </Text>
      )}
    </Pressable>
  );
}

type Palette = ReturnType<typeof usePreferences>["palette"];

function markdownStyle(palette: Palette, t: number) {
  return {
    body: {
      color: palette.text,
      fontSize: 16 * t,
      lineHeight: 26 * t,
      letterSpacing: 0.3,
    },
    heading1: {
      color: palette.text,
      fontSize: 20 * t,
      fontWeight: "700" as const,
      marginVertical: 8,
    },
    heading2: {
      color: palette.text,
      fontSize: 18 * t,
      fontWeight: "700" as const,
      marginVertical: 6,
    },
    heading3: {
      color: palette.text,
      fontSize: 16 * t,
      fontWeight: "600" as const,
      marginVertical: 4,
    },
    strong: { color: palette.text, fontWeight: "700" as const },
    em: { fontStyle: "italic" as const },
    link: { color: palette.brand },
    code_inline: {
      backgroundColor: palette.surfaceMuted,
      color: palette.text,
      fontFamily: "Menlo",
      fontSize: 13 * t,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    fence: {
      backgroundColor: palette.surfaceMuted,
      borderColor: palette.border,
      borderWidth: StyleSheet.hairlineWidth,
      fontFamily: "Menlo",
      fontSize: 12 * t,
      color: palette.text,
      borderRadius: 8,
      padding: 10,
      lineHeight: 18 * t,
    },
    code_block: {
      backgroundColor: palette.surfaceMuted,
      borderRadius: 8,
      padding: 10,
    },
    bullet_list_icon: { color: palette.textSecondary },
    ordered_list_icon: { color: palette.textSecondary, fontSize: 14 * t },
    blockquote: {
      backgroundColor: palette.surfaceMuted,
      borderLeftColor: palette.brand,
      borderLeftWidth: 3,
      borderRadius: 4,
      paddingLeft: spacing.x2,
      paddingVertical: spacing.x1,
      marginVertical: spacing.x1,
    },
    hr: {
      backgroundColor: palette.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: spacing.x2,
    },
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 8,
      overflow: "hidden" as const,
    },
    thead: { backgroundColor: palette.surfaceMuted },
    th: {
      color: palette.text,
      fontWeight: "700" as const,
      padding: spacing.x2,
      borderColor: palette.border,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    td: {
      color: palette.text,
      padding: spacing.x2,
      borderColor: palette.border,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    tr: {
      borderColor: palette.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
  };
}

/** 代码块高亮：头部（语言标签 + 复制）+ 语法高亮，深浅色用不同样式。 */
function markdownRules(palette: Palette, dark: boolean, t: number) {
  const codeStyle = dark ? atomOneDark : docco;
  const copyCode = (code: string): void => {
    void Clipboard.setStringAsync(code);
  };
  return {
    fence: (
      node: { content: string; sourceInfo?: string },
      _children: unknown,
      _parent: unknown,
      _styles: unknown,
    ): React.JSX.Element => {
      const language = (node.sourceInfo ?? "").trim() || "text";
      return (
        <View style={[styles.codeBlock, { borderColor: palette.border }]}>
          <View
            style={[
              styles.codeHead,
              {
                borderBottomColor: palette.border,
                backgroundColor: palette.surfaceMuted,
              },
            ]}
          >
            <Text
              style={[
                styles.codeLang,
                { color: palette.textSecondary, fontFamily: "Menlo" },
              ]}
            >
              {language}
            </Text>
            <Pressable
              onPress={() => copyCode(node.content)}
              hitSlop={8}
              style={styles.codeCopyBtn}
            >
              <AppIcon name="copy" color={palette.brand} size={12} />
              <Text style={[styles.codeCopy, { color: palette.brand }]}>
                复制
              </Text>
            </Pressable>
          </View>
          <SyntaxHighlighter
            language={language}
            style={codeStyle}
            highlighter="hljs"
            fontSize={12 * t}
          >
            {node.content}
          </SyntaxHighlighter>
        </View>
      );
    },
  };
}

/** DSML 文本协议工具调用：内联卡（未执行态）。 */
function DsmlToolCard({ call }: Readonly<{ call: DsmlToolCall }>) {
  const { palette } = usePreferences();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={[
        styles.toolCard,
        { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
      ]}
    >
      <Pressable style={styles.toolHead} onPress={() => setOpen(!open)}>
        <View style={[styles.stateDot, { backgroundColor: palette.warning }]} />
        <Text style={[styles.toolVariant, { color: palette.text }]}>
          {call.name}
        </Text>
        <Text
          style={[styles.toolSummary, { color: palette.textSecondary }]}
          numberOfLines={1}
        >
          {call.summary}
        </Text>
        <Text style={[styles.toolStatus, { color: palette.warning }]}>
          {open ? "▾" : "▸"} 未执行
        </Text>
      </Pressable>
      {open && (
        <View style={styles.toolBody}>
          <Text style={[styles.mono, { color: palette.text }]}>{call.raw}</Text>
        </View>
      )}
    </View>
  );
}

const TOOL_STATUS_COLOR: Record<
  ToolStatus,
  "success" | "error" | "warning" | "textSecondary"
> = {
  ok: "success",
  error: "error",
  running: "warning",
  stopped: "warning",
};
const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  ok: "完成",
  error: "失败",
  running: "执行中",
  stopped: "已停止",
};
const TOOL_ICON: Record<string, IconName> = {
  Bash: "terminal",
  Read: "file-text",
  Write: "file-text",
  Edit: "edit",
  Search: "search",
  Code: "code",
  Tool: "settings",
};

function ToolRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences();
  const [open, setOpen] = useState(false);
  const status = item.toolStatus ?? "running";
  const colorKey = TOOL_STATUS_COLOR[status];
  const color = palette[colorKey];
  return (
    <View
      style={[
        styles.toolCard,
        { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
      ]}
    >
      <Pressable style={styles.toolHead} onPress={() => setOpen(!open)}>
        <AppIcon
          name={TOOL_ICON[item.variant ?? "Tool"] ?? "settings"}
          color={color}
          size={14}
        />
        <Text style={[styles.toolVariant, { color: palette.text }]}>
          {item.variant}
        </Text>
        <Text
          style={[
            styles.toolSummary,
            {
              color: status === "error" ? palette.error : palette.textSecondary,
            },
          ]}
          numberOfLines={1}
        >
          {status === "error" && (item.errorLine ?? "").length > 0
            ? item.errorLine
            : item.summary}
        </Text>
        <Text style={[styles.toolStatus, { color }]}>
          {open ? "▾" : "▸"} {TOOL_STATUS_LABEL[status]}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.toolBody}>
          {item.argsPretty !== undefined && item.argsPretty.length > 0 && (
            <>
              <Text
                style={[styles.toolBodyLabel, { color: palette.textSecondary }]}
              >
                输入
              </Text>
              <Text style={[styles.mono, { color: palette.text }]}>
                {item.argsPretty}
              </Text>
            </>
          )}
          {item.outputPreview !== undefined &&
            item.outputPreview.length > 0 && (
              <>
                <Text
                  style={[
                    styles.toolBodyLabel,
                    { color: palette.textSecondary },
                  ]}
                >
                  输出
                </Text>
                <Text style={[styles.mono, { color: palette.text }]}>
                  {item.outputPreview}
                </Text>
              </>
            )}
        </View>
      )}
    </View>
  );
}

/** dsh StatsLine 紧凑数字：517 / 1.3K / 1.2M（一位小数）。 */
function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** turn-tail 时钟行（对齐 dsh TurnTailNodeView：耗时 · tokens · 速率）。 */
function tailStats(item: TimelineItem): string {
  const parts: string[] = [];
  if (item.ranMs !== undefined) {
    const s = item.ranMs / 1000;
    parts.push(
      s >= 60
        ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
        : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`,
    );
  }
  if (
    item.turnTokens !== undefined &&
    (item.turnTokens.input > 0 || item.turnTokens.output > 0)
  ) {
    parts.push(
      `${compactTokens(item.turnTokens.input)} in · ${compactTokens(item.turnTokens.output)} out`,
    );
    if (
      item.ranMs !== undefined &&
      item.ranMs > 1000 &&
      item.turnTokens.output > 0
    ) {
      parts.push(
        `${Math.round(item.turnTokens.output / (item.ranMs / 1000))} tok/s`,
      );
    }
  }
  return parts.join(" · ");
}

function CompactionRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences();
  const [open, setOpen] = useState(false);
  const info = item.compaction;
  if (info === undefined) return null;
  return (
    <Pressable
      style={[styles.compactionRow, { borderColor: palette.border }]}
      onPress={() => setOpen(!open)}
    >
      <Text style={[styles.compactionLabel, { color: palette.info }]}>
        上下文压缩 {open ? "▾" : "▸"} · {info.items} 条 ·{" "}
        {compactTokens(info.tokens)} tokens
      </Text>
      {open && (
        <Text style={[styles.compactionBody, { color: palette.textSecondary }]}>
          {info.summaryText}
        </Text>
      )}
    </Pressable>
  );
}

function TurnEndRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences();
  const stats = tailStats(item);
  if (item.turnReason === "completed") {
    return (
      <Text style={[styles.turnEnd, { color: palette.textSecondary }]}>
        — 回合完成{stats.length > 0 ? ` · ${stats}` : ""} —
      </Text>
    );
  }
  if (item.turnReason === "error") {
    return (
      <View style={[styles.turnEndCard, { borderColor: palette.error }]}>
        <View style={[styles.stateDot, { backgroundColor: palette.error }]} />
        <Text
          style={[styles.turnEndText, { color: palette.error }]}
          numberOfLines={2}
        >
          回合错误：{item.reasonMessage}
          {stats.length > 0 ? `（${stats}）` : ""}
        </Text>
      </View>
    );
  }
  if (item.turnReason === "max-tokens") {
    return (
      <View style={[styles.turnEndCard, { borderColor: palette.warning }]}>
        <View style={[styles.stateDot, { backgroundColor: palette.warning }]} />
        <Text style={[styles.turnEndText, { color: palette.warning }]}>
          达到输出上限（max-tokens）
        </Text>
      </View>
    );
  }
  return (
    <Text style={[styles.turnEnd, { color: palette.textSecondary }]}>
      — 已停止 —
    </Text>
  );
}

// ---------- 审批 / 提问（接管输入区，对齐 dsh ApprovalPanel） ----------

function ServerRequestCard({
  request,
}: Readonly<{
  request: import("@deepseek-harness-pocket/bridge-protocol").ServerRequest;
}>) {
  const { palette } = usePreferences();
  const respondPermission = useDshStore((s) => s.respondPermission);
  const respondQuestion = useDshStore((s) => s.respondQuestion);
  const [answer, setAnswer] = useState("");

  if (request.kind === "permission") {
    return (
      <View
        style={[
          styles.composerCard,
          { borderTopColor: palette.warning, backgroundColor: palette.surface },
        ]}
      >
        <Text style={[styles.askTitle, { color: palette.warning }]}>
          等待审批
        </Text>
        <Text
          style={[styles.askBody, { color: palette.text }]}
          numberOfLines={3}
        >
          {request.body.summary}
        </Text>
        <View style={styles.askActions}>
          <Pressable
            style={[
              styles.askButton,
              { borderColor: palette.textSecondary, borderWidth: 1 },
            ]}
            onPress={() =>
              void respondPermission(request.body.requestId, "deny")
            }
          >
            <Text
              style={[styles.askButtonText, { color: palette.textSecondary }]}
            >
              拒绝
            </Text>
          </Pressable>
          <Pressable
            style={[styles.askButton, { backgroundColor: palette.brand }]}
            onPress={() =>
              void respondPermission(request.body.requestId, "allow")
            }
          >
            <Text style={[styles.askButtonText, { color: "#FFFFFF" }]}>
              允许一次
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.composerCard,
        { borderTopColor: palette.info, backgroundColor: palette.surface },
      ]}
    >
      <Text style={[styles.askTitle, { color: palette.info }]}>Agent 提问</Text>
      <Text style={[styles.askBody, { color: palette.text }]}>
        {request.body.question}
      </Text>
      {request.body.options !== undefined && (
        <View style={styles.askActions}>
          {request.body.options.map((option) => (
            <Pressable
              key={option}
              style={[styles.askButton, { backgroundColor: palette.brand }]}
              onPress={() =>
                void respondQuestion(request.body.requestId, option)
              }
            >
              <Text style={[styles.askButtonText, { color: "#FFFFFF" }]}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={[styles.answerRow, { borderColor: palette.border }]}>
        <TextInput
          style={[styles.answerInput, { color: palette.text }]}
          placeholder="输入回答…"
          placeholderTextColor={palette.textSecondary}
          value={answer}
          onChangeText={setAnswer}
        />
        <Pressable
          style={[styles.answerSend, { backgroundColor: palette.brand }]}
          onPress={() => void respondQuestion(request.body.requestId, answer)}
        >
          <Text style={styles.answerSendText}>发送</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 长按消息菜单（hover 等价）：复制全文 / 从这里分支。改底部 Sheet ≥50%（#12）。 */
function MessageActionSheet(
  props: Readonly<{ target: TimelineItem | null; onClose: () => void }>,
) {
  const { palette } = usePreferences();
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const forkSession = useDshStore((s) => s.forkSession);
  const [copied, setNoticeCopied] = useState(false);
  const target = props.target;
  const text =
    (target?.blocks ?? []).map((b) => b.text).join("\n\n") ||
    target?.text ||
    "";

  const copy = (): void => {
    void Clipboard.setStringAsync(text).then(() => setNoticeCopied(true));
  };

  const fork = (): void => {
    props.onClose();
    if (target !== null && activeSessionId !== null)
      void forkSession(activeSessionId, target.seq);
  };

  return (
    <Sheet
      visible={target !== null}
      title="消息操作"
      onClose={props.onClose}
      snapPoints={["50%"]}
    >
      <Text
        style={[sheetStyles.title, { color: palette.text }]}
        numberOfLines={2}
      >
        {text.slice(0, 80)}
      </Text>
      <SheetAction label={copied ? "已复制 ✓" : "复制全文"} onPress={copy} />
      <SheetAction label="fork 新会话" onPress={fork} />
    </Sheet>
  );
}

function SheetAction({
  label,
  onPress,
  muted,
}: Readonly<{ label: string; onPress: () => void; muted?: boolean }>) {
  const { palette } = usePreferences();
  return (
    <Pressable
      style={({ pressed }) => [
        sheetStyles.action,
        pressed && { backgroundColor: palette.surfaceMuted },
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          sheetStyles.actionText,
          { color: muted === true ? palette.textSecondary : palette.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 会话页字号档位（与 theme/styles.ts 全局一致）：28 标题 / 20 大字 / 16 正文 /
 * 14 次要 / 13 标签 / 12 说明。全部乘 textScale（设置页「字体大小」）。
 */
const makeSheetStyles = (t: number) =>
  StyleSheet.create({
    scrim: { flex: 1, justifyContent: "center", padding: spacing.x6 },
    sheet: { borderRadius: radii.card, padding: spacing.x2 },
    title: { fontSize: 13 * t, lineHeight: 18 * t, padding: spacing.x2, opacity: 0.7 },
    action: {
      paddingVertical: spacing.x3,
      paddingHorizontal: spacing.x3,
      borderRadius: radii.control,
    },
    actionText: { fontSize: 16 * t },
  });

let sheetStyles = makeSheetStyles(1);

const makeStyles = (t: number) =>
  StyleSheet.create({
    container: { flex: 1 },
    containerSession: {
      flex: 1,
      justifyContent: "center",
    },
    sessionLoading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.x2,
    },
    sessionLoadingText: { fontSize: 13 * t },
    empty: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyTitle: { fontSize: 16 * t },
    notice: {
      padding: spacing.x2,
      margin: spacing.x2,
      borderRadius: radii.control,
    },
    noticeText: { fontSize: 13 * t },
    timeline: { flex: 1 },
    userRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      flexWrap: "nowrap", // 允许换行
      alignItems: "center", // 垂直居中
      flexShrink: 0,
    },
    userBubble: {
      maxWidth: "80%",
      borderRadius: radii.card,
      padding: spacing.x3,
      borderBottomRightRadius: radii.small,
    },
    userText: { fontSize: 16 * t, lineHeight: 24 * t, letterSpacing: 0.3 },
    assistantBubble: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      gap: spacing.x2,
    },
    assistantText: { fontSize: 16 * t, lineHeight: 26 * t, letterSpacing: 0.3 },
    thinkRow: {
      borderRadius: radii.control,
      padding: spacing.x2,
      gap: spacing.x1,
    },
    thinkHead: { flexDirection: "row", alignItems: "center", gap: spacing.x1 },
    thinkLabel: { fontSize: 12 * t, fontWeight: "600" },
    thinkSummary: { flex: 1, fontSize: 12 * t },
    thinkBody: { fontSize: 13 * t, lineHeight: 20 * t, paddingTop: spacing.x1 },
    stoppedMark: { fontSize: 12 * t, alignSelf: "flex-end" },
    usageLine: { fontSize: 12 * t, alignSelf: "flex-end" },
    toolCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radii.control,
      alignSelf: "stretch",
    },
    toolHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.x2,
      padding: spacing.x2,
    },
    toolVariant: { fontSize: 13 * t },
    toolSummary: { flex: 1, fontSize: 12 * t, fontFamily: "Menlo" },
    toolStatus: { fontSize: 12 * t },
    toolBody: {
      padding: spacing.x2,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: spacing.x1,
    },
    toolBodyLabel: { fontSize: 12 * t },
    mono: { fontSize: 12 * t, fontFamily: "Menlo", lineHeight: 17 * t },
    turnEnd: { fontSize: 12 * t, textAlign: "center", paddingVertical: spacing.x1 },
    dsmlGroup: { gap: spacing.x2 },
    dsmlHint: { fontSize: 12 * t, lineHeight: 16 * t },
    compactionRow: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radii.control,
      padding: spacing.x2,
      alignSelf: "center",
    },
    compactionLabel: { fontSize: 12 * t },
    ciRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.x2,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radii.control,
      padding: spacing.x2,
      alignSelf: "stretch",
    },
    ciHeader: { flexDirection: "row", alignItems: "center", gap: spacing.x2 },
    ciTitle: { fontSize: 12 * t, fontWeight: "600" },
    ciProducer: { flex: 1, fontSize: 12 * t, fontFamily: "Menlo" },
    ciSummary: { fontSize: 12 * t, marginTop: 2 },
    ciBody: { marginTop: spacing.x1, gap: spacing.x1 },
    ciSection: { paddingVertical: spacing.x1 },
    ciSectionName: { fontSize: 12 * t, fontWeight: "600" },
    ciSectionText: { fontSize: 12 * t, lineHeight: 17 * t },
    codeBlock: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      overflow: "hidden",
    },
    codeHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.x2,
      paddingVertical: spacing.x1,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    codeLang: { fontSize: 12 * t },
    codeCopy: { fontSize: 12 * t, fontWeight: "600" },
    codeCopyBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    compactionBody: { fontSize: 12 * t, lineHeight: 18 * t, paddingTop: spacing.x1 },
    turnEndCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.x2,
      borderWidth: 1,
      borderRadius: radii.control,
      padding: spacing.x2,
      alignSelf: "center",
    },
    turnEndText: { fontSize: 13 * t, flexShrink: 1 },
    stateDot: { width: 8, height: 8, borderRadius: 4 },
    composerCard: { borderTopWidth: 2, padding: spacing.x3, gap: spacing.x2 },
    askTitle: { fontSize: 13 * t },
    askBody: { fontSize: 14 * t, lineHeight: 20 * t },
    askActions: { flexDirection: "row", gap: spacing.x2, flexWrap: "wrap" },
    askButton: {
      paddingHorizontal: spacing.x4,
      paddingVertical: spacing.x2,
      borderRadius: radii.round,
    },
    askButtonText: { fontSize: 14 * t },
    answerRow: {
      flexDirection: "row",
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radii.control,
      alignItems: "center",
    },
    answerInput: { flex: 1, padding: spacing.x2, fontSize: 14 * t },
    answerSend: { padding: spacing.x2, borderRadius: radii.small },
    answerSendText: { color: "#FFFFFF", fontSize: 13 * t },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.x2,
      padding: spacing.x2,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    stopButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.x1,
      borderWidth: 1,
      borderRadius: radii.round,
      paddingHorizontal: spacing.x3,
      paddingVertical: spacing.x2,
    },
    stopText: { fontSize: 13 * t },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      padding: spacing.x2,
      fontSize: 16 * t,
    },
    send: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
  });

let styles = makeStyles(1);
