/**
 * 会话时间线（对齐新版设计稿）：
 *   - 用户右对齐气泡（brand 底）
 *   - assistant 全宽卡片：思考折叠（思考过程）+ 正文（流式纯文本，定稿 Markdown）
 *     + 卡底 metrics footer（回合完成 · in/out）
 *   - 工具行：状态图标 + 变体名 · 单行摘要，点按展开 IN/OUT（卡片形态保留）
 *   - 回合尾：completed 细线 / error 红 / max-tokens 琥珀 / stopped 标记
 *   - 审批与提问接管 composer 上方（对齐 dsh ApprovalPanel 行为：仅允许一次/拒绝）
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import SyntaxHighlighter from "react-native-syntax-highlighter";
import { docco } from "react-syntax-highlighter/styles/hljs";
import atomOneDark from "react-syntax-highlighter/styles/hljs/atom-one-dark";
import * as Clipboard from "expo-clipboard";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useCSSVariable, useUniwind } from "uniwind";
import { AppIcon, IconName } from "../../design-system/AppIcon";
import { Sheet } from "../../design-system/Sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { useDshStore } from "../../state/dshStore";
import { useApp } from "../../state/AppStore";
import { usePreferences } from "../../preferences/PreferencesProvider";
import type { AssistantBlock, TimelineItem, ToolStatus } from "./reducer";
import { splitDsml, cutAtDsmlStart, type DsmlToolCall } from "./dsml";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  type FeedbackCategory,
  type QuestionAnswerItem,
  type UserQuestionBody,
  type UserQuestionItem,
} from "@deepseek-harness-pocket/bridge-protocol";
import { collapseContext, describeTool, type ToolDescriptor } from "./toolPresentation";
import { groupTurns, shouldFold, type TurnGroup } from "./turns";
import { Composer } from "./Composer";

export function ConversationScreen() {
  const view = useDshStore((s) => s.sessionView);
  const notice = useDshStore((s) => s.notice);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const sessionLoading = useDshStore((s) => s.sessionLoading);
  const serverRequests = useDshStore((s) => s.serverRequests);
  const primary = useCSSVariable("--color-primary") as string | undefined;
  const scrollRef = useRef<ScrollView>(null);
  const [actionTarget, setActionTarget] = useState<TimelineItem | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [view.items.length]);

  if (activeSessionId === null) {
    // 对齐设计稿新建会话页：居中大输入区（首条消息即建会话）
    return (
      <View className="bg-background flex-1">
        <View className="flex-1 justify-center">
          <Composer mode="new" />
        </View>
      </View>
    );
  }

  if (sessionLoading && view.items.length === 0) {
    // 快照在途：明确加载态，避免「点了没反应」的观感
    return (
      <View className="bg-background flex-1">
        <View className="flex-1 items-center justify-center gap-2">
          <ActivityIndicator color={primary} />
          <Text className="text-muted-foreground text-[13px]">
            正在加载会话…
          </Text>
        </View>
      </View>
    );
  }

  const pending = serverRequests[0];
  const turns = groupTurns(view.items);

  return (
    /* 键盘避让：SDK 57 edge-to-edge 下 Android adjustResize 失效、iOS 无原生避让，
       会话屏根部包 KAV（双平台 padding），保证 composer 始终在键盘上方。
       automaticOffset 必须：KAV 算 padding 时把 onLayout 的「父容器局部坐标」与
       「窗口坐标的键盘顶」直接相减，而 App.tsx 的 SafeAreaView 用顶部 inset 把整屏
       内容下移了状态栏高度 → padding 少算状态栏高度，composer 底部正好被键盘盖住；
       automaticOffset 改用窗口绝对坐标自纠偏（keyboardVerticalOffset 亦可，但要手动传 inset） */
    <KeyboardAvoidingView
      behavior="padding"
      automaticOffset
      style={{ flex: 1 }}
    >
      <View className="bg-background flex-1">
        {notice !== null && (
          <View className="bg-warning-soft m-2 rounded-xl p-2">
            <Text className="text-warning text-[13px]">
              {notice}
            </Text>
          </View>
        )}
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-2 p-3 pb-4"
        >
          {turns.map((group, index) => (
            <View key={group.key} className="gap-2">
              {group.user !== null && (
                <TimelineRow item={group.user} onLongPress={setActionTarget} />
              )}
              <TurnProcess
                group={group}
                defaultOpen={index === turns.length - 1}
                onLongPress={setActionTarget}
              />
              {group.result.map((item) => (
                <TimelineRow
                  key={item.key}
                  item={item}
                  onLongPress={setActionTarget}
                />
              ))}
            </View>
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
  if (item.kind === "notice") return <NoticeRow item={item} />;
  return <TurnEndRow item={item} />;
}

/** 轻量提示行（批次 1）：模型重试、系统消息等非时间线主体的可见状态。 */
/**
 * 回合过程折叠（批次 2，对齐 Web 的 turn-process folding）。
 * 过程项少时不折；最后一个回合默认展开（正在进行的回合要看得见）。
 */
function TurnProcess({
  group,
  defaultOpen,
  onLongPress,
}: Readonly<{
  group: TurnGroup;
  defaultOpen: boolean;
  onLongPress: (item: TimelineItem) => void;
}>) {
  const fold = shouldFold(group);
  const [open, setOpen] = useState(defaultOpen);
  if (group.process.length === 0) return null;
  if (!fold) {
    return (
      <>
        {group.process.map((item) => (
          <TimelineRow key={item.key} item={item} onLongPress={onLongPress} />
        ))}
      </>
    );
  }
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "收起过程" : "展开过程"}
        className="border-border bg-card flex-row items-center gap-2 self-start rounded-full border px-3 py-1 active:bg-accent"
        onPress={() => setOpen((v) => !v)}
      >
        <AppIcon name={open ? "chevron-up" : "chevron-down"} size={12} />
        <Text className="text-muted-foreground text-[11px]">
          过程 · {group.process.length} 项
          {group.toolCount > 0 ? ` · ${group.toolCount} 个工具` : ""}
        </Text>
      </Pressable>
      {open &&
        group.process.map((item) => (
          <TimelineRow key={item.key} item={item} onLongPress={onLongPress} />
        ))}
    </View>
  );
}

function NoticeRow({ item }: Readonly<{ item: TimelineItem }>) {
  return (
    <View className="flex-row justify-center">
      <View className="bg-muted rounded-full px-3 py-1">
        <Text className="text-muted-foreground text-[11px]" numberOfLines={2}>
          {item.text}
        </Text>
      </View>
    </View>
  );
}

/** 用户气泡：右对齐 brand 底圆角卡（图片附件当前以 📷×N 文本标记随文显示）。 */
function UserRow({
  item,
  onLongPress,
}: Readonly<{
  item: TimelineItem;
  onLongPress: (item: TimelineItem) => void;
}>) {
  return (
    <View className="flex-row justify-end">
      <Pressable
        onLongPress={() => onLongPress(item)}
        delayLongPress={350}
        className="bg-primary max-w-[85%] rounded-xl rounded-br-sm px-3.5 py-2.5"
      >
        <Text
          numberOfLines={undefined}
          className="text-primary-foreground text-base leading-6 tracking-wide"
        >
          {item.text}
        </Text>
      </Pressable>
    </View>
  );
}

/** 上下文注入（对齐 dsh ContextInjectionRow）：非 user 来源的折叠行，标题 + 来源 + 摘要 + 展开 body（snapshot 展示 sections 分段）。 */
function ContextInjectionRow({ item }: Readonly<{ item: TimelineItem }>) {
  const muted = useCSSVariable("--color-muted-foreground") as string | undefined;
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
      className="border-border bg-card flex-row items-start gap-2 self-stretch rounded-xl border p-3"
      onPress={() => setOpen(!open)}
    >
      <AppIcon name="globe" color={muted} size={14} />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-foreground text-xs font-semibold">{label}</Text>
          {item.producer !== undefined && (
            <Text
              className="text-muted-foreground flex-1 font-mono text-xs"
              numberOfLines={1}
            >
              {item.producer}
            </Text>
          )}
        </View>
        {summary.length > 0 && (
          <Text
            className="text-muted-foreground mt-0.5 text-xs"
            numberOfLines={open ? undefined : 1}
          >
            {summary}
          </Text>
        )}
        {open && (
          <View className="mt-1 gap-1">
            {item.sections !== undefined && item.sections.length > 0
              ? item.sections.map((s, i) => (
                  <View key={i} className="py-1">
                    <Text className="text-primary font-mono text-xs font-semibold">
                      {s.name}
                    </Text>
                    <Text className="text-muted-foreground text-xs leading-[17px]">
                      {s.text}
                    </Text>
                  </View>
                ))
              : item.text !== undefined &&
                item.text.length > 0 && (
                  <Text className="text-muted-foreground text-xs leading-[17px]">
                    {item.text}
                  </Text>
                )}
          </View>
        )}
      </View>
      <AppIcon name="chevron-right" color={muted} size={14} />
    </Pressable>
  );
}

/** 助手卡片（设计稿）：surface 卡内混排 blocks；卡底 usage metrics footer。 */
function AssistantRow({
  item,
  onLongPress,
}: Readonly<{
  item: TimelineItem;
  onLongPress: (item: TimelineItem) => void;
}>) {
  const blocks = item.blocks ?? [];
  return (
    <Pressable
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      className="bg-card border-border gap-2 self-stretch rounded-xl border p-3"
    >
      {blocks.map((block, i) => (
        <AssistantBlockView
          key={i}
          block={block}
          streaming={item.streaming === true}
        />
      ))}
      {blocks.length === 0 && item.streaming === true && (
        <Text className="text-muted-foreground text-xs">思考中…</Text>
      )}
      {item.stopped === true && (
        <Text className="text-warning self-end text-xs">
          已停止
        </Text>
      )}
      {item.usage !== undefined && (
        <View>
          <Separator />
          <View className="flex-row justify-between pt-2">
            <Text className="text-muted-foreground font-mono text-[11px]">
              回合完成
            </Text>
            <Text className="text-muted-foreground font-mono text-[11px]">
              {compactTokens(item.usage.input)} in · {compactTokens(item.usage.output)} out
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Markdown 渲染所需的命令式颜色（Markdown / SyntaxHighlighter 只接受内联值）。 */
type MdColors = Readonly<{
  foreground: string;
  muted: string;
  border: string;
  primary: string;
  codeBg: string;
  subtle: string;
}>;

/** Markdown 命令式配色（组件内读取 CSS 变量）。 */
function useMdColors(): MdColors {
  const [foreground, muted, border, primary, mutedBg] = useCSSVariable([
    "--color-foreground",
    "--color-muted-foreground",
    "--color-border",
    "--color-primary",
    "--color-muted",
  ]) as [string, string, string, string, string];
  return { foreground, muted, border, primary, codeBg: mutedBg, subtle: mutedBg };
}

/** text → 正文（流式纯文本，定稿 Markdown）；reasoning → 「思考过程」折叠盒。 */
function AssistantBlockView({
  block,
  streaming,
}: Readonly<{ block: AssistantBlock; streaming: boolean }>) {
  const { theme } = useUniwind();
  const { textScale } = usePreferences();
  const [foreground, muted, border, primary, mutedBg] = useCSSVariable([
    "--color-foreground",
    "--color-muted-foreground",
    "--color-border",
    "--color-primary",
    "--color-muted",
  ]) as [string, string, string, string, string];
  const [open, setOpen] = useState(false);
  const colors: MdColors = {
    foreground,
    muted,
    border,
    primary,
    codeBg: mutedBg,
    subtle: mutedBg,
  };
  if (block.type === "text") {
    if (streaming) {
      return (
        <Text
          className="text-foreground text-base leading-[26px] tracking-wide"
          style={{ fontSize: 16 * textScale, lineHeight: 26 * textScale }}
        >
          {cutAtDsmlStart(block.text)}
          {" ▍"}
        </Text>
      );
    }
    const { prose, calls } = splitDsml(block.text);
    if (calls.length > 0) {
      return (
        <View className="gap-2">
          {prose.length > 0 && (
            <Markdown
              style={markdownStyle(colors, textScale)}
              rules={markdownRules(colors, theme === "dark")}
            >
              {prose}
            </Markdown>
          )}
          {calls.map((call, i) => (
            <DsmlToolCard key={i} call={call} />
          ))}
          <Text className="text-muted-foreground text-xs leading-4">
            以上工具调用由模型以文本协议输出、未被 dsh 执行（上游 adapter 未解析
            DSML）
          </Text>
        </View>
      );
    }
    return (
      <Markdown
        style={markdownStyle(colors, textScale)}
        rules={markdownRules(colors, theme === "dark")}
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
      className="bg-muted/50 border-border gap-1 rounded-lg border p-2.5"
      onPress={() => setOpen(!open)}
    >
      <View className="flex-row items-center gap-1">
        <Text className="text-muted-foreground text-xs font-bold">
          思考过程:{" "}
        </Text>
        {!open && (
          <Text
            className="text-muted-foreground flex-1 text-xs"
            numberOfLines={2}
          >
            {summary.length > 0 ? summary : `${block.text.length} 字`}
          </Text>
        )}
        <AppIcon
          name={open ? "chevron-up" : "chevron-down"}
          color={muted}
          size={12}
        />
      </View>
      {open && (
        <Text className="text-muted-foreground pt-1 text-xs leading-[18px]">
          {block.text}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Markdown 内联样式。字号按用户「字体大小」偏好缩放：
 * Uniwind/Tailwind 的字号在构建期固定，运行时无法用 CSS 变量缩放，故在此显式相乘。
 */
function markdownStyle(c: MdColors, scale = 1) {
  const s = (n: number): number => Math.round(n * scale * 10) / 10;
  return {
    body: {
      color: c.foreground,
      fontSize: s(16),
      lineHeight: s(26),
      letterSpacing: 0.3,
    },
    heading1: {
      color: c.foreground,
      fontSize: s(20),
      fontWeight: "700" as const,
      marginVertical: 8,
    },
    heading2: {
      color: c.foreground,
      fontSize: s(18),
      fontWeight: "700" as const,
      marginVertical: 6,
    },
    heading3: {
      color: c.foreground,
      fontSize: s(16),
      fontWeight: "600" as const,
      marginVertical: 4,
    },
    strong: { color: c.foreground, fontWeight: "700" as const },
    em: { fontStyle: "italic" as const },
    link: { color: c.primary },
    code_inline: {
      backgroundColor: c.codeBg,
      color: c.foreground,
      fontFamily: "Menlo",
      fontSize: s(13),
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    fence: {
      backgroundColor: c.codeBg,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      fontFamily: "Menlo",
      fontSize: s(12),
      color: c.foreground,
      borderRadius: 8,
      padding: 10,
      lineHeight: s(18),
    },
    code_block: {
      backgroundColor: c.codeBg,
      borderRadius: 8,
      padding: 10,
    },
    bullet_list_icon: { color: c.muted },
    ordered_list_icon: { color: c.muted, fontSize: s(14) },
    blockquote: {
      backgroundColor: c.subtle,
      borderLeftColor: c.primary,
      borderLeftWidth: 3,
      borderRadius: 4,
      paddingLeft: 8,
      paddingVertical: 4,
      marginVertical: 4,
    },
    hr: {
      backgroundColor: c.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: 8,
    },
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 8,
      overflow: "hidden" as const,
    },
    thead: { backgroundColor: c.subtle },
    th: {
      color: c.foreground,
      fontWeight: "700" as const,
      padding: 8,
      borderColor: c.border,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    td: {
      color: c.foreground,
      padding: 8,
      borderColor: c.border,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    tr: {
      borderColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
  };
}

/** 代码块高亮：头部（语言标签 + 复制）+ 语法高亮，深浅色用不同样式。 */
function markdownRules(c: MdColors, dark: boolean) {
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
        <View className="border-border overflow-hidden rounded-lg border">
          <View className="border-border bg-muted flex-row items-center justify-between border-b px-2 py-1">
            <Text className="text-muted-foreground font-mono text-xs">
              {language}
            </Text>
            <Pressable
              onPress={() => copyCode(node.content)}
              hitSlop={8}
              className="flex-row items-center gap-1"
            >
              <AppIcon name="copy" color={c.primary} size={12} />
              <Text className="text-primary text-xs font-semibold">
                复制
              </Text>
            </Pressable>
          </View>
          <SyntaxHighlighter
            language={language}
            style={codeStyle}
            highlighter="hljs"
            fontSize={12}
           {...({ PreTag: View, CodeTag: View } as Record<string, unknown>)}>
            {node.content}
          </SyntaxHighlighter>
        </View>
      );
    },
  };
}

/** DSML 文本协议工具调用：内联卡（未执行态）。 */
function DsmlToolCard({ call }: Readonly<{ call: DsmlToolCall }>) {
  const [open, setOpen] = useState(false);
  return (
    <View className="border-border bg-muted self-stretch rounded-xl border">
      <Pressable
        className="flex-row items-center gap-2 p-2"
        onPress={() => setOpen(!open)}
      >
        <View className="bg-warning h-2 w-2 rounded-full" />
        <Text className="text-foreground text-[13px]">{call.name}</Text>
        <Text
          className="text-muted-foreground flex-1 font-mono text-xs"
          numberOfLines={1}
        >
          {call.summary}
        </Text>
        <Text className="text-warning text-xs">
          {open ? "▾" : "▸"} 未执行
        </Text>
      </Pressable>
      {open && (
        <View className="border-border gap-1 border-t p-2">
          <Text className="text-foreground font-mono text-xs leading-[17px]">
            {call.raw}
          </Text>
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

/**
 * 工具卡内的结构化呈现（批次 1）：diff / 待办 / 技能 / 交付文件。
 * 数据由 `toolPresentation.describeTool` 从 tool/call 入参归一化而来。
 */
function ToolDescriptorBody({ descriptor }: Readonly<{ descriptor: ToolDescriptor }>) {
  if (descriptor.diff !== undefined) {
    const lines = collapseContext(descriptor.diff.lines, 3);
    return (
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-muted-foreground text-xs">变更</Text>
          <Text className="text-[11px] text-success">
            +{descriptor.diff.added}
          </Text>
          <Text className="text-destructive text-[11px]">−{descriptor.diff.removed}</Text>
          {descriptor.diff.truncated ? (
            <Text className="text-muted-foreground text-[11px]">（过大，已折叠）</Text>
          ) : null}
        </View>
        <View className="border-border bg-background overflow-hidden rounded-md border">
          {lines.map((line, index) => (
            <Text
              key={index}
              className={
                line.kind === "add"
                  ? "bg-success/10 px-2 font-mono text-[11px] leading-[16px] text-success"
                  : line.kind === "del"
                    ? "bg-destructive/10 text-destructive px-2 font-mono text-[11px] leading-[16px]"
                    : "text-muted-foreground px-2 font-mono text-[11px] leading-[16px]"
              }
            >
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
              {line.text}
            </Text>
          ))}
        </View>
      </View>
    );
  }
  if (descriptor.todos !== undefined) {
    return (
      <View className="gap-1">
        {descriptor.todos.map((todo, index) => (
          <View key={index} className="flex-row items-center gap-2">
            <AppIcon
              name={
                todo.status === "completed"
                  ? "check-circle"
                  : todo.status === "in_progress"
                    ? "clock"
                    : "minus"
              }
              size={12}
            />
            <Text
              className={
                todo.status === "completed"
                  ? "text-muted-foreground flex-1 text-xs line-through"
                  : "text-foreground flex-1 text-xs"
              }
            >
              {todo.text}
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (descriptor.skill !== undefined && descriptor.skill.name.length > 0) {
    return (
      <Text className="text-muted-foreground text-xs">
        技能：<Text className="text-foreground font-mono text-xs">{descriptor.skill.name}</Text>
      </Text>
    );
  }
  if (descriptor.files !== undefined) {
    return (
      <View className="gap-1">
        <Text className="text-muted-foreground text-xs">交付文件</Text>
        {descriptor.files.map((file, index) => (
          <Text key={index} className="text-foreground font-mono text-[11px]">
            {file}
          </Text>
        ))}
      </View>
    );
  }
  return null;
}

function ToolRow({ item }: Readonly<{ item: TimelineItem }>) {
  const [muted, success, warning, destructive] = useCSSVariable([
    "--color-muted-foreground",
    "--color-chart-2",
    "--color-chart-4",
    "--color-destructive",
  ]) as [string, string, string, string];
  const [open, setOpen] = useState(false);
  const status = item.toolStatus ?? "running";
  const colorKey = TOOL_STATUS_COLOR[status];
  const color =
    colorKey === "success"
      ? success
      : colorKey === "error"
        ? destructive
        : colorKey === "warning"
          ? warning
          : muted;
  return (
    <View className="border-border bg-muted self-stretch rounded-xl border">
      <Pressable
        className="flex-row items-center gap-2 p-2"
        onPress={() => setOpen(!open)}
      >
        <AppIcon
          name={TOOL_ICON[item.variant ?? "Tool"] ?? "settings"}
          color={color}
          size={14}
        />
        <Text className="text-foreground text-[13px]">{item.variant}</Text>
        <Text
          className={
            status === "error"
              ? "text-destructive flex-1 font-mono text-xs"
              : "text-muted-foreground flex-1 font-mono text-xs"
          }
          numberOfLines={1}
        >
          {status === "error" && (item.errorLine ?? "").length > 0
            ? item.errorLine
            : item.summary}
        </Text>
        {item.descriptor?.diff !== undefined && (
          <View className="flex-row items-center gap-1">
            <Text className="text-[11px] text-success">
              +{item.descriptor.diff.added}
            </Text>
            <Text className="text-destructive text-[11px]">
              −{item.descriptor.diff.removed}
            </Text>
          </View>
        )}
        <Text className="text-xs" style={{ color }}>
          {open ? "▾" : "▸"} {TOOL_STATUS_LABEL[status]}
        </Text>
      </Pressable>
      {open && (
        <View className="border-border gap-1 border-t p-2">
          {item.argsPretty !== undefined && item.argsPretty.length > 0 && (
            <>
              <Text className="text-muted-foreground text-xs">输入</Text>
              <Text className="text-foreground font-mono text-xs leading-[17px]">
                {item.argsPretty}
              </Text>
            </>
          )}
          {item.outputPreview !== undefined &&
            item.outputPreview.length > 0 && (
              <>
                <Text className="text-muted-foreground text-xs">输出</Text>
                <Text className="text-foreground font-mono text-xs leading-[17px]">
                  {item.outputPreview}
                </Text>
              </>
            )}
          {item.descriptor !== undefined && (
            <ToolDescriptorBody descriptor={item.descriptor} />
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
  const [open, setOpen] = useState(false);
  const info = item.compaction;
  if (info === undefined) return null;
  return (
    <Pressable
      className="border-border self-center rounded-xl border p-2"
      onPress={() => setOpen(!open)}
    >
      <Text className="text-primary text-xs">
        上下文压缩 {open ? "▾" : "▸"} · {info.items} 条 ·{" "}
        {compactTokens(info.tokens)} tokens
      </Text>
      {open && (
        <Text className="text-muted-foreground pt-1 text-xs leading-[18px]">
          {info.summaryText}
        </Text>
      )}
    </Pressable>
  );
}

function TurnTailLine({ item }: Readonly<{ item: TimelineItem }>) {
  const stats = tailStats(item);
  if (item.turnReason === "completed") {
    return (
      <Text className="text-muted-foreground py-1 text-center text-xs">
        — 回合完成{stats.length > 0 ? ` · ${stats}` : ""} —
      </Text>
    );
  }
  if (item.turnReason === "error") {
    return (
      <View className="border-destructive flex-row items-center gap-2 self-center rounded-xl border p-2">
        <View className="bg-destructive h-2 w-2 rounded-full" />
        <Text
          className="text-destructive flex-shrink text-[13px]"
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
      <View className="border-warning flex-row items-center gap-2 self-center rounded-xl border p-2">
        <View className="bg-warning h-2 w-2 rounded-full" />
        <Text className="text-warning text-[13px]">
          达到输出上限（max-tokens）
        </Text>
      </View>
    );
  }
  return (
    <Text className="text-muted-foreground py-1 text-center text-xs">
      — 已停止 —
    </Text>
  );
}

/**
 * 回合尾：统计行 + 「变更文件」chips（批次 2，对齐 Web 的 Files changed）。
 * 芯片点按复制完整路径。
 */
function TurnEndRow({ item }: Readonly<{ item: TimelineItem }>) {
  return (
    <View className="gap-1.5">
      <TurnTailLine item={item} />
      {item.files !== undefined && item.files.length > 0 && (
        <DeliveredFiles files={item.files} />
      )}
    </View>
  );
}

function DeliveredFiles({ files }: Readonly<{ files: readonly string[] }>) {
  const { showToast } = useApp();
  return (
    <View className="gap-1">
      <Text className="text-muted-foreground text-[11px]">变更文件</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row gap-1.5"
      >
        {files.map((file) => (
          <Pressable
            key={file}
            accessibilityRole="button"
            accessibilityLabel={`复制路径 ${file}`}
            className="border-border bg-card rounded-md border px-2 py-1 active:bg-accent"
            onPress={() => {
              void Clipboard.setStringAsync(file);
              showToast("路径已复制", "success");
            }}
          >
            <Text className="text-foreground font-mono text-[11px]">
              {file.split("/").pop() ?? file}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------- 审批 / 提问（接管输入区，对齐 dsh ApprovalPanel） ----------

function ServerRequestCard({
  request,
}: Readonly<{
  request: import("@deepseek-harness-pocket/bridge-protocol").ServerRequest;
}>) {
  const respondPermission = useDshStore((s) => s.respondPermission);
  const respondQuestion = useDshStore((s) => s.respondQuestion);
  const [detailOpen, setDetailOpen] = useState(false);

  if (request.kind === "permission") {
    return (
      <View className="bg-card gap-2 border-t-2 border-t-warning p-3">
        <Text className="text-warning text-[13px]">
          等待审批
        </Text>
        <Text className="text-foreground text-sm leading-5" numberOfLines={detailOpen ? undefined : 3}>
          {request.body.summary}
        </Text>
        {request.body.detail !== undefined && (
          <View className="gap-1.5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={detailOpen ? "收起审批详情" : "查看审批详情"}
              className="self-start"
              onPress={() => setDetailOpen((v) => !v)}
            >
              <Text className="text-primary text-xs">
                {detailOpen ? "收起详情" : "查看详情"}
              </Text>
            </Pressable>
            {detailOpen && <PermissionDetail detail={request.body.detail} />}
          </View>
        )}
        <View className="flex-row flex-wrap gap-2">
          <Button
            variant="outline"
            className="rounded-full px-4"
            onPress={() =>
              void respondPermission(request.body.requestId, "deny")
            }
          >
            <Text className="text-muted-foreground text-sm">拒绝</Text>
          </Button>
          <Button
            className="rounded-full px-4"
            onPress={() =>
              void respondPermission(request.body.requestId, "allow")
            }
          >
            <Text className="text-sm">允许一次</Text>
          </Button>
        </View>
      </View>
    );
  }
  return (
    <QuestionCard
      body={request.body}
      onSubmit={(answers) =>
        void respondQuestion(request.body.requestId, answers)
      }
    />
  );
}

/**
 * 提问接管卡（批次 2）：完整对齐 dsh-user-questions。
 *   - 多题导航（上一题/下一题/跳过）
 *   - 多选 / 选项描述
 *   - intent.kind === 'plan-review' → 计划评审：detail 即计划正文，按 approve label 批准
 */
/**
 * 审批详情（批次 2）：bridge 用 callId 回查到的工具入参。
 * 复用工具呈现层——edit/write 直接渲染 diff，其余展示结构化入参。
 */
function PermissionDetail({ detail }: Readonly<{ detail: Readonly<Record<string, unknown>> }>) {
  const name = typeof detail["name"] === "string" ? detail["name"] : "";
  const args = detail["arguments"];
  const raw = detail["argumentsRaw"];
  const descriptor =
    name.length > 0
      ? describeTool(name, typeof args === "object" && args !== null ? JSON.stringify(args) : "")
      : null;
  return (
    <View className="border-border gap-1.5 rounded-xl border p-2">
      {descriptor !== null && (
        <Text className="text-muted-foreground text-xs">
          {descriptor.title}
          {descriptor.summary.length > 0 ? ` · ${descriptor.summary}` : ""}
        </Text>
      )}
      {descriptor !== null && <ToolDescriptorBody descriptor={descriptor} />}
      {typeof args === "object" && args !== null && descriptor?.diff === undefined && (
        <Text className="text-foreground font-mono text-[11px] leading-[16px]">
          {JSON.stringify(args, null, 2).slice(0, 2000)}
        </Text>
      )}
      {typeof raw === "string" && raw.length > 0 && (
        <Text className="text-muted-foreground font-mono text-[11px] leading-[16px]">
          {raw}
        </Text>
      )}
    </View>
  );
}

function QuestionCard({
  body,
  onSubmit,
}: Readonly<{
  body: UserQuestionBody;
  onSubmit: (answers: readonly QuestionAnswerItem[]) => void;
}>) {
  const questions = useMemo<UserQuestionItem[]>(() => {
    if (body.questions !== undefined && body.questions.length > 0) {
      return [...body.questions];
    }
    return [
      {
        id: "",
        question: body.question,
        ...(body.options !== undefined
          ? { options: body.options.map((label) => ({ label })) }
          : {}),
      },
    ];
  }, [body]);
  const mdColors = useMdColors();
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<Record<string, readonly string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const current = questions[index] ?? questions[0]!;
  const key = current.id;
  const selected = chosen[key] ?? [];
  const isPlanReview = current.intent?.kind === "plan-review";

  const toggle = (label: string): void => {
    setChosen((prev) => {
      const now = prev[key] ?? [];
      if (current.multiSelect === true) {
        return {
          ...prev,
          [key]: now.includes(label)
            ? now.filter((l) => l !== label)
            : [...now, label],
        };
      }
      return { ...prev, [key]: now.includes(label) ? [] : [label] };
    });
  };

  const submitAll = (): void => {
    onSubmit(
      questions.map((q) => ({
        id: q.id,
        selected: chosen[q.id] ?? [],
        ...(custom[q.id] !== undefined && custom[q.id]!.length > 0
          ? { custom: custom[q.id]! }
          : {}),
      })),
    );
  };

  // 计划评审：detail 是计划正文；批准 = intent.approve，其余选项即否决
  if (isPlanReview) {
    const approveLabel = current.intent!.approve;
    return (
      <View className="bg-card border-t-primary gap-2 border-t-2 p-3">
        <Text className="text-primary text-[13px]">
          {current.header ?? "计划评审"}
        </Text>
        <ScrollView className="max-h-[240px]">
          {current.detail !== undefined ? (
            <Markdown style={markdownStyle(mdColors)}>
              {current.detail}
            </Markdown>
          ) : (
            <Text className="text-foreground text-sm leading-5">
              {current.question}
            </Text>
          )}
        </ScrollView>
        <View className="flex-row flex-wrap gap-2">
          {(current.options ?? []).map((option) => {
            const approve = option.label === approveLabel;
            return (
              <Button
                key={option.label}
                variant={approve ? "default" : "outline"}
                className="rounded-full px-4"
                onPress={() => onSubmit([{ id: current.id, selected: [option.label] }])}
              >
                <Text className="text-sm">{option.label}</Text>
              </Button>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View className="bg-card border-t-primary gap-2 border-t-2 p-3">
      <View className="flex-row items-center gap-2">
        <Text className="text-primary text-[13px]">
          {current.header ?? "Agent 提问"}
        </Text>
        {questions.length > 1 && (
          <Text className="text-muted-foreground text-[11px]">
            {index + 1}/{questions.length}
          </Text>
        )}
      </View>
      <Text className="text-foreground text-sm leading-5">
        {current.question}
      </Text>
      {current.detail !== undefined && (
        <Text className="text-muted-foreground text-xs leading-4">
          {current.detail}
        </Text>
      )}
      {current.options !== undefined && current.options.length > 0 && (
        <View className="gap-1.5">
          {current.options.map((option) => {
            const on = selected.includes(option.label);
            return (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                className={
                  on
                    ? "border-primary bg-primary/10 rounded-xl border px-3 py-2"
                    : "border-border bg-muted/40 rounded-xl border px-3 py-2"
                }
                onPress={() => toggle(option.label)}
              >
                <Text className="text-foreground text-sm">{option.label}</Text>
                {option.description !== undefined && (
                  <Text className="text-muted-foreground text-[11px]">
                    {option.description}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      <Input
        className="w-full"
        placeholder="其他回答（可选）"
        value={custom[key] ?? ""}
        onChangeText={(value) => setCustom((prev) => ({ ...prev, [key]: value }))}
      />
      <View className="flex-row items-center gap-2">
        {index > 0 && (
          <Button variant="ghost" onPress={() => setIndex((i) => i - 1)}>
            <Text className="text-muted-foreground">上一题</Text>
          </Button>
        )}
        {questions.length > 1 && (
          <Button
            variant="ghost"
            onPress={() => {
              setChosen((prev) => ({ ...prev, [key]: [] }));
              if (index < questions.length - 1) setIndex((i) => i + 1);
            }}
          >
            <Text className="text-muted-foreground">跳过</Text>
          </Button>
        )}
        <View className="flex-1" />
        {index < questions.length - 1 ? (
          <Button onPress={() => setIndex((i) => i + 1)}>
            <Text>下一题</Text>
          </Button>
        ) : (
          <Button onPress={submitAll}>
            <Text>提交</Text>
          </Button>
        )}
      </View>
    </View>
  );
}

/** 长按消息菜单（hover 等价）：复制全文 / 从这里分支。改底部 Sheet ≥50%（#12）。 */
function MessageActionSheet(
  props: Readonly<{ target: TimelineItem | null; onClose: () => void }>,
) {
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const forkSession = useDshStore((s) => s.forkSession);
  const rateMessage = useDshStore((s) => s.rateMessage);
  const removeFeedback = useDshStore((s) => s.removeFeedback);
  const feedbackMap = useDshStore((s) => s.feedback);
  const loadFeedback = useDshStore((s) => s.loadFeedback);
  const [copied, setNoticeCopied] = useState(false);
  // 负反馈需要分类与备注：在同一个 Sheet 内切换形态，避免套娃弹层
  const [mode, setMode] = useState<"menu" | "negative">("menu");
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [note, setNote] = useState("");
  const target = props.target;
  // 打开消息操作时补拉一次反馈（避免每次打开会话都请求）
  useEffect(() => {
    if (target !== null) void loadFeedback();
  }, [target, loadFeedback]);
  const text =
    (target?.blocks ?? []).map((b) => b.text).join("\n\n") ||
    target?.text ||
    "";
  const messageId = target?.kind === "assistant" ? target.messageId : undefined;
  const current = messageId !== undefined ? feedbackMap[messageId] : undefined;

  const close = (): void => {
    setMode("menu");
    setNote("");
    setCategory(null);
    props.onClose();
  };

  const copy = (): void => {
    void Clipboard.setStringAsync(text).then(() => setNoticeCopied(true));
  };

  const fork = (): void => {
    close();
    if (target !== null && activeSessionId !== null)
      void forkSession(activeSessionId, target.seq);
  };

  const rate = (rating: "positive" | "negative"): void => {
    if (messageId === undefined) return;
    // 再点同一个评价 = 撤销
    if (current?.rating === rating) {
      void removeFeedback(messageId);
      close();
      return;
    }
    if (rating === "positive") {
      void rateMessage(messageId, "positive");
      close();
      return;
    }
    setMode("negative");
  };

  const submitNegative = (): void => {
    if (messageId === undefined) return;
    void rateMessage(
      messageId,
      "negative",
      note.trim().length > 0 ? note.trim() : undefined,
      category ?? undefined,
    );
    close();
  };

  if (mode === "negative") {
    return (
      <Sheet visible={target !== null} title="反馈问题" onClose={close} scrollable>
        <Text className="text-muted-foreground px-2 text-[12px]">
          问题出在哪一类？（可选）
        </Text>
        <View className="flex-row flex-wrap gap-2 p-2">
          {FEEDBACK_CATEGORIES.map((c) => {
            const on = category === c;
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                className={
                  on
                    ? "border-primary bg-primary/10 rounded-full border px-3 py-1.5"
                    : "border-border bg-muted/40 rounded-full border px-3 py-1.5"
                }
                onPress={() => setCategory(on ? null : c)}
              >
                <Text className="text-foreground text-xs">
                  {FEEDBACK_CATEGORY_LABELS[c]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Textarea
          className="mx-2 min-h-[80px]"
          placeholder="补充说明（可选）"
          value={note}
          onChangeText={setNote}
          numberOfLines={3}
        />
        <View className="mt-2 flex-row justify-end gap-2 px-2">
          <Button variant="ghost" onPress={close}>
            <Text className="text-muted-foreground">取消</Text>
          </Button>
          <Button onPress={submitNegative}>
            <Text>提交</Text>
          </Button>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={target !== null}
      title="消息操作"
      onClose={close}
      snapPoints={["50%"]}
    >
      <Text
        className="text-muted-foreground px-2 text-[13px] leading-[18px]"
        numberOfLines={2}
      >
        {text.slice(0, 80)}
      </Text>
      {messageId !== undefined && (
        <View className="flex-row items-center gap-2 px-2 py-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="有用"
            className={
              current?.rating === "positive"
                ? "border-primary bg-primary/10 flex-1 items-center rounded-xl border py-2.5"
                : "border-border bg-muted/40 flex-1 items-center rounded-xl border py-2.5"
            }
            onPress={() => rate("positive")}
          >
            <Text className="text-foreground text-sm">👍 有用</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="有问题"
            className={
              current?.rating === "negative"
                ? "border-destructive bg-destructive/10 flex-1 items-center rounded-xl border py-2.5"
                : "border-border bg-muted/40 flex-1 items-center rounded-xl border py-2.5"
            }
            onPress={() => rate("negative")}
          >
            <Text className="text-foreground text-sm">👎 有问题</Text>
          </Pressable>
        </View>
      )}
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
  return (
    <Pressable
      className="active:bg-muted rounded-xl px-3 py-3"
      onPress={onPress}
    >
      <Text
        className={
          muted === true
            ? "text-muted-foreground text-base"
            : "text-foreground text-base"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
