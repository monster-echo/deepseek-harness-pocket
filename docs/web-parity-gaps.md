# 手机端 ↔ DSH Web 功能对齐缺口清单

对比基准：`@deepseek-ai/dsh` 0.1.5-rc.1 的 **web profile**（`dsh web`，本机 3080）
对比对象：`react-native/` 手机 App + `packages/bridge`（mobile/v1 协议）

## 交付依赖图例

| 标记 | 含义 |
|---|---|
| 🟢 | **协议/事件已具备**，纯 UI 工作，手机端 reducer 里能直接读到数据 |
| 🟡 | **bridge 要小改**（补字段 / 多透传一类帧 / 加一个 RPC） |
| 🔴 | **需要新增协议面 + 宿主远端**（Web 走独立 Remote / projection / catalog，mobile/v1 目前没有） |

> Web 侧没有、手机端也不必补的：全局快捷键、桌面通知/提示音（Web 两者都没有）；定时任务 schedule 在 Web 默认**未启用**。

---

## 1. 对话渲染与 Agent 能力（最大缺口）

手机端 `reducer.ts` 目前只处理 `user/message`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、
`turn/start|end`、`permission/preset`、`compaction/summary`、`step/start|end`；**其余事件类型一律丢弃**（`reducer.ts:560-566`）。

### 1.1 完全缺失的 Agent 能力

| # | 功能 | Web 表现 | 手机端现状 | 依赖 |
|---|---|---|---|---|
| 1.1.1 | **目标条 GoalBar** | composer 上方目标条：阶段（Ongoing/Inactive/Paused/Blocked）+ objective + Pause/Resume/Edit/Clear + blocked reason | 0；`/goal` 是 `暂未实现` stub | 🟢 事件 `goal/activation-changed` + goal 投影 |
| 1.1.2 | **计划模式 Plan** | composer 警示色 "Plan ×" 药丸，点击退出；`/plan` 进入；另有计划评审卡 | 0；`/plan` 被当普通文本发给 agent | 🟡 plan 事件 + 评审走 takeover |
| 1.1.3 | **计划评审 Plan review** | markdown 计划 + Approve / Refuse / Chat about it | 0 | 🟡 |
| 1.1.4 | **待办 To-do dock** | composer 上方可折叠 "To-dos"，含 done/active/pending 进度与状态字形 | 0 | 🟢 `todo_write` 工具事件 |
| 1.1.5 | **Todo 工具专用渲染** | `todo_write` 工具行渲染成待办清单 | 通用工具卡 | 🟢 |
| 1.1.6 | **Subagent 子代理** | 会话头 `x subagents` → 树形目录（parent/child、模式、活动、token 合计、时长、重试）；同级切换器；可续聊子会话的只读/可交互 composer | 0（子代理工具调用只显示成通用卡） | 🔴 目录/续聊是宿主 Remote；`subagent/*` 事件也未透传 |
| 1.1.7 | **Workflow 运行节点** | 持久节点：run 名、成员数、阶段与成员、聚合状态（Running n · Failed n · Interrupted n · Completed n），异常结束自动展开，可打开运行中成员子会话 | 0 | 🟡 `tool-workflow/*` 事件已可透传 |
| 1.1.8 | **消息级反馈** | 助手消息操作条 👍/👎 + 7 类分类对话框 + `/feedback` | 0；`/feedback` 是 stub | 🔴 messageFeedback / sessionFeedback Host Remotes |
| 1.1.9 | **Cordis 动态插件** | 侧栏底部运行数徽标 → popover（本会话/其他会话分组、状态、版本切换、Approve once/future/Decline、Run/Stop/Remove、Retry/Roll back）；`cordis_define` 工具卡带 run/stop 开关 | 0 | 🔴 面板/审批需 RPC；🟡 工具卡渲染可先做 |
| 1.1.10 | **后台任务列表** | 会话头 jobs 按钮（数量 + StateDot）→ popover（kind、label、status、elapsed，live 优先，时长跳动），只读 | 0 | 🟡 `session/jobs` 帧需透传 |
| 1.1.11 | **定时任务目录** | 会话头闹钟按钮 + 只读 popover（Scheduled/Overdue、prompt、频率、本地时间、相对时间）；侧栏行 alarm 标记 | 0 | 🔴 `schedule-catalog`（**Web 默认未启用**，可延后） |
| 1.1.12 | **会话导出** | 会话头 more-actions "Download session log" + `/export`：会话树 + 附件 ZIP，三阶段对话框 | `/export` 是 stub | 🟡 导出 RPC |
| 1.1.13 | **轨迹 Trajectory 视图** | 虚拟化事件账本 + 3 泳道交互时间线（缩放/平移/range select）+ 明细检查器（Summary/Raw/Schema/Timing/Diff/System Prompt/Tools/Options/Usage）+ 工具栏（实际/等宽时长、全部展开折叠、搜索） | 只有回合级与聚合统计（`SessionInfoSheet`），无逐 step 时间线 | 🟢 纯客户端投影 |

### 1.2 对话流渲染的细化缺口

| # | 功能 | Web 表现 | 手机端现状 | 依赖 |
|---|---|---|---|---|
| 1.2.1 | **工具 diff 渲染** | edit/write 文件 diff 变更视图 + `+N -N` 统计 | 工具卡只显示 args/输出，无 diff | 🟢 `tool/call` 入参已含 old/new |
| 1.2.2 | **递归工具调用树** | 根 + 嵌套子调用带左侧轨；通用 ToolRow（图标、title、summary、diff 统计、Input/Output、Inspect、路径按钮） | 平铺工具卡，无嵌套、无 Inspect | 🟢 |
| 1.2.3 | **工具调用 Inspect** | 跳转到 Trajectory 明细 | 0（依赖 1.1.13） | 🟢 |
| 1.2.4 | **用户消息图片** | `conversation.message.images` 真图（单图 ≤240px，多图 64px 方块 + 文件卡，失败重试） | 只降级成文本 `📷×N`（`reducer.ts:148`） | 🟡 上传 ref 未回读成可显示资源 |
| 1.2.5 | **工具结果图片** | `read_image` 键控行 + 图片画廊 | 工具结果是嵌套 content 的**纯文本叶子**，图片叶子被忽略 | 🟢 |
| 1.2.6 | **Skill 专用行** | `skill` 键控行 + Shimmer + Instructions 卡 + Inspect | 通用工具卡 | 🟢 |
| 1.2.7 | **Deliverables 交付物** | 收尾助手消息下方 "Files changed" chips（≤6 + "+N files"）；present 交付卡网格（Open / Open in default app / Show in Finder / Open containing folder，状态行，>4 折叠）；正文内联文件路径可点 | 有独立「作品」Sheet，但不挂回合、正文路径不可点 | 🟢 `present` 工具 + preview 帧已具备 |
| 1.2.8 | **系统提示词行** | 折叠行，展开显示模型可见的完整 system prompt | 0 | 🟢 事件已透传 |
| 1.2.9 | **回合过程折叠** | 每回合可折叠，显示 tool-call/消息/子代理计数或 "Thought for a while" | 0 | 🟢 |
| 1.2.10 | **模型重试行** | active/cancelled/started/scheduled/delay/failure 各态 | 0（事件被丢弃） | 🟢 |
| 1.2.11 | **更多回合尾态** | `turn-error` / `turn-max-tokens` / `turn-process` / auth-failure / steering / unknown 节点 | 有 completed/error/max-tokens/aborted 四态 | 🟢 |
| 1.2.12 | **回合导航轨** | 每个回合的固定刻度标记，hover 预览卡，active/busy 态，渐变淡出 | 0 | 🟢 |
| 1.2.13 | **回到顶部/底部** | "Back to bottom" 浮动按钮 + "Load earlier" 分页（loading/error 文案） | 无分页，一次性快照 | 🟡 需 history paging RPC |
| 1.2.14 | **回合用量/耗时面板** | provider/model、cache hit、uncached/cached input、cache write、output、reasoning、count；总时长、tok/s、TTFT | 有回合级 in/out/tok/s（`tailStats`），无明细面板 | 🟢 |
| 1.2.15 | **会话统计/用量 pills** | turns/steps pill → "Session statistics" 与 "Token usage" 对话框（全 log 投影，窗口回退） | `SessionInfoSheet` + ContextUsageSheet 覆盖大部分 | 🟢 |
| 1.2.16 | **手动压缩可见** | `/compact` 命令卡 + 结果计数；`compaction/start|end` 的 running/completed/unavailable 行 | 只渲染 `compaction/summary` | 🟢 |
| 1.2.17 | **上下文注入细分** | instructions/catalog/snapshot/notice/relay/recall 多种 form 各有 detail 正文 | 已有「上下文注入/召回」折叠行（简化） | 🟢 基本对齐 |
| 1.2.18 | **转录显示密度** | "Conversation display" Normal/Compact（默认 Compact） | 0（只有字体大小） | 🟢 |
| 1.2.19 | **队列消息编辑** | 可折叠 "N queued messages"：行内 Edit/Save/Cancel、Remove、Steer（运行时可用）、附件缩略图、Sending… 态、失败 toast | 有客户端 `pendingQueue` 只读计数 | 🟡 steer 需宿主命令通道 |
| 1.2.20 | **Enter 行为（发送时）** | General 设置 Queue vs Steer，决定 Enter 与运行中 Send 按钮文案；Cmd/Ctrl+Enter 走另一模式 | 只有「排队发送」开关，无 steer | 🟡 |

## 2. 会话头与导航

| # | 功能 | Web 表现 | 手机端现状 | 依赖 |
|---|---|---|---|---|
| 2.1 | **会话层级面包屑** | 会话头 ancestor crumbs（可回跳祖先会话）+ subagent crumbs + 当前项 disabled；空白会话隐藏 chrome | 0 | 🟢 会话列表已有 parentId 可投影 |
| 2.2 | **会话重命名** | 对话框重命名（自动标题被 pin 住） | 0（只能重命名 workspace） | 🟡 |
| 2.3 | **会话归档** | Archive session | 0 | 🟡 |
| 2.4 | **从侧栏 Fork 会话** | 侧栏菜单 Fork session（另有消息级 Branch） | 只有消息级 fork；侧栏无入口 | 🟢 |
| 2.5 | **拖拽排序** | 拖拽 session（前后落点标记）与 workspace，workspace 顺序宿主持久化 | 0（仅置顶，内存态） | 🟡 |
| 2.6 | **分组/排序视图选项** | Group by → WorkSpace / In one list；Order by → Manual / Last updated | 固定按 workspace 分组 + 最近活动排序 | 🟢 |
| 2.7 | **会话分页展示** | 默认 5 条非空 + 临时空白 New Session 行；"Show N more sessions" / "Show less" | 一次性全量列表 | 🟡 |
| 2.8 | **内容搜索** | 标题 + workspace 子串即时匹配，另 250ms 防抖的**正文**排序搜索（带 snippet，上限 20，可取消） | 仅标题/cwd 过滤 | 🟡 内容搜索需 query RPC |
| 2.9 | **状态点与待处理标记** | running、"N subagent(s) running"、idle、琥珀色警告点（等待审批/计划待审/等待回答） | 只有 running | 🟢 需列表补 projection |
| 2.10 | **子代理来源隐藏** | `origin: 'subagent'` 的会话不进侧栏；普通行在其后代运行时继承活动态 | N/A（无子代理） | 🟢 |
| 2.11 | **悬停复制卡** | hover workspace 行复制完整路径；hover session 行复制完整标题 | 0（移动端可用长按替代） | 🟢 |
| 2.12 | **Open In... 拆分按钮** | 主按钮用记住的应用打开会话工作区目录；chevron 列已安装应用（VS Code/Cursor/Zed/JetBrains 系/终端/Finder/Explorer/git 客户端） | 0 | 🟡 需宿主 open-in-app RPC |

## 3. 输入、引用与命令

| # | 功能 | Web 表现 | 手机端现状 | 依赖 |
|---|---|---|---|---|
| 3.1 | **@ 真实文件/目录引用** | "Files & folders" 段：目录钻取 + 面包屑 + `@"带空格路径"` + 原子 chip；文件引用可在右侧栏打开（可定位行号） | `@` 只插入 workspace 名（`Composer.tsx:461` 注释明说协议暂缺） | 🔴 需引用编解码 + 文件搜索 RPC |
| 3.2 | **@ 会话引用** | "Sessions" 段：会话提及带 cwd·age | 0 | 🟢 `sessions.list` 已有 |
| 3.3 | **@ 子代理引用** | 文档声明支持（当前构建未注册） | 0 | 🔴 同 1.1.6 |
| 3.4 | **@ Cordis 引用** | 插入已定义动态插件引用 | 0 | 🔴 |
| 3.5 | **/ Skill 源** | 模型可调用技能列表，标注 "user-only"，插入 `/name ` | ✅ 已落地 | 🟢 |
| 3.6 | **/ 命令装饰与类型** | popupSelect（`/model`、`/permission`）、action（`/feedback`）、宿主命令直执行；附件拒绝 toast；风险选项确认 | 只有 `/permission`、`/model` 特判 + 其余按文本发送 | 🟢 前端可扩 |
| 3.7 | **触发菜单能力** | `/` 与 `@` 光标处检测、分组候选、Tab 钻取、面包屑、combobox a11y | 有基础 autocomplete + 工作区提及 | 🟡 |
| 3.8 | **通用文件附件** | 附件轨：64px 图片方块 + 240px 文件卡（类型字形、名称、扩展名+大小）、边缘滚动箭头、上传 spinner + 字节进度、失败重试；拖拽整屏投放区 | 仅相册选图，无通用文件、无进度/重试 | 🟡 |
| 3.9 | **图片灯箱** | 文档级 modal，Escape/遮罩/关闭，焦点恢复 | 有缩略图行，无灯箱 | 🟢 |

## 4. 右侧栏与文档预览

| # | 功能 | Web 表现 | 手机端现状 | 依赖 |
|---|---|---|---|---|
| 4.1 | **工作区文件树 tab** | Files 页：根路径头 + Reload、懒加载目录展开、点击文件开预览 tab、截断/空/错误态 | 只有选目录用的 DirectoryPicker + 作品列表，无常驻文件浏览 | 🟢 `fs.list` 已有 |
| 4.2 | **文档预览渲染** | "Open with" 渲染器菜单、line-wrap 开关、Reload、分页（Load more / 滚到底）、源码行定位；渲染器：纯文本 / Markdown（含脚注、复制）/ 代码（高亮+行号+复制）/ HTML（沙箱 iframe + 关联资源）/ 图片 / **PDF**（懒加载宽度适配翻页） | 全走 WebView data URI，md 不渲染、代码不高亮、**PDF 不支持** | 🟡 预览白名单 `preview.ts` 补 PDF；其余纯 UI |
| 4.3 | **侧栏 tab 体系** | tab 关闭/新增、双栏 split、拖拽 dock/float、20–80% 缩放、guide tab、未认领类型回退 | N/A（单列）；需为 4.1/4.2 设计落点 | 🟢 设计问题 |
| 4.4 | **面板 push/fullscreen** | 右侧栏记忆态、展开/折叠、push 或 fullscreen 呈现（<768px 自动 fullscreen） | N/A | 🟢 |

## 5. 设置

| # | 功能 | Web 表现 | 手机端现状 | 依赖 |
|---|---|---|---|---|
| 5.1 | **模型供应商管理** | provider 列表 + 凭据状态点、Edit/Delete、首启设置卡、Add provider / Add custom provider、API key（含 env 只读变体）、Display name、Base URL、API protocol、DeepSeek 模型目录编辑器（capacities、恢复默认、增删）、"Fetch available models" 多选、删除确认 modal | 只读模型目录 + 选默认模型 | 🔴 settings/credentials Remote |
| 5.2 | **插件配置编辑** | ⚠️ 只读已落地（命名空间值预览）；**编辑待做**。Web: "Plugin configuration" tab：可展开配置卡（Shell、Agent loop、Subagent、Web search）、staged 编辑、Overridden 徽标、Reset to default、secret 字段、Discard/Save、只读部署提示；"Plugin list" tab：搜索、按 preset 分组、全局插件、启用/fiber 状态、retry | 只读列表（名称 + 启停） | 🔴 settings-plugins Remote |
| 5.3 | **Agent preset 管理** | built-in/custom 卡、in-use 徽标、duplicate/view/open-folder/delete/set-default、creator 草稿 | 只能为新会话选 preset | 🔴 preset CRUD RPC |
| 5.4 | **打开配置文件** | Settings 头 "Open configuration file" | 0 | 🟡 |
| 5.5 | **连接指示** | "Disconnected"/"Reconnecting"（动态点）/"Connected" + "Reconnect now" | 有 gateway 连接态与重试，形式不同 | 🟢 基本对齐 |
| 5.6 | **内容字号** | 12–17px 步进（默认 14），"Only affects conversation content" | 有字体大小档位（0.9/1/1.15/1.3） | 🟢 已对齐 |
| 5.7 | **主题 / 语言 / 权限默认 / 转录密度 / 发送行为** | General 五行 | 主题、语言、权限默认已有；转录密度与发送行为缺 | 🟢/🟡 |

## 6. 审批与提问

| # | 功能 | Web 表现 | 手机端现状 | 依赖 |
|---|---|---|---|---|
| 6.1 | **审批详情** | "Approval details" + 关联工具详情 + 升级理由 | 只有一行 summary；bridge 里 `detail` 恒为 `null`（`adapter-dsh.ts:769`） | 🟡 bridge 填 detail（工具入参） |
| 6.2 | **多问题导航** | eyebrow/title、markdown detail、单选/多选 + Recommended 徽标、自定义答案文本域、Previous/Next 分页、Skip、Submit | 单问题 + 选项 + 自由输入；bridge 只取 `questions[0]`（`adapter-dsh.ts:799`） | 🟡 协议补多问题数组 |
| 6.3 | **composer takeover 链** | `pendingInteraction` 选举 approval / plan review / question 三者接管 composer | 已有审批/提问接管（无 plan review） | 🟢 |
| 6.4 | **待处理分类标记** | 审批/计划审/提问在侧栏行上的优先级点 | 0 | 🟢 |

> 注：Web 审批只有 **Allow once / Reject**（无持久策略）；手机端 RPC 支持 `allow-always` 但 UI 未暴露——这是手机端**超出 Web** 的能力，不算缺口。

## 7. 跨端一致性风险（不是「功能」，但会直接卡住 UI）

| # | 项 | 现状 | 影响 | 依赖 |
|---|---|---|---|---|
| 7.1 | **caps 默认档位不一致** | 插件 `config.ts:33` 默认 `m2`，CLI `start` 默认 `m3`（`cli/index.ts:45`） | 走 m2 时**新建会话/选目录/作品预览全部被拒** | 🟡 统一默认 |
| 7.2 | **长工具输出截断** | 快照 `tool/result` 文本截到 4000 字符（`hub.ts` `SNAPSHOT_TEXT_LIMIT`） | 长输出看不到，diff/轨迹视图受限 | 🟡 按需拉取 |
| 7.3 | **推送链路未接通** | worker 从不发 `notify`；app 定义了 `registerPushToken` 但从未调用；收到 push 只取 title、忽略 body/sessionId | 手机端本该超过 Web 的能力目前等于没接 | 🟡 |
| 7.4 | **无历史分页** | 一次性快照 + 无 `loadOlder` / `loadThrough` | 长会话首开慢，无法回到更早 | 🟡 |
| 7.5 | **i18n 覆盖** | 仅约 30 条设置文案 zh/en，其余硬编码中文（Web 有完整 locale + 插件语言包） | 英文用户可用性 | 🟢 纯 UI |
| 7.6 | **渲染能力** | 无 ANSI 终端、无 LaTeX/mermaid、无语法感知 diff、无 PDF | 与 Web 工具行/预览差距 | 🟢/🟡 |
| 7.7 | **附件形态** | 仅相册选图，无相机、无通用文件附件、无上传进度/重试 | 与 Web 附件轨差距 | 🟡 |

## 8. 已对齐（不用做，避免重复投入）

模型与推理档位选择、权限预设（含 Full access 风险确认）、Agent preset 选择、图片附件上传、上下文注入/召回折叠行、
Markdown 渲染（标题/列表/表格/引用/代码块）、代码高亮 + 复制、思考过程折叠、压缩摘要行、回合耗时/token/缓存统计、
会话搜索与按 workspace 分组、running 状态点、消息级 fork、复制全文、workspace 增删改、目录选择、作品浏览与 WebView 预览、
主题（明/暗/跟随系统）、语言、字体大小、拉取刷新、配对码流程、审批接管、提问接管、空会话 Hero、连接状态与重试。

**手机端超出 Web 的能力**（不是缺口）：加密 Gateway 中转、多 Worker 切换、扫码配对、账号/会员/支付/优惠券/邀请、
设备管理、支持工单、通知中心、应用内反馈、遥测、`allow-always` 审批、会话置顶。

**Web 也没有、无需补**：全局快捷键（Cmd/Ctrl+K）、桌面通知、提示音、checkpoint/rewind UI（fork 是唯一用户可见分支原语）。

---

## 建议的 UI 实现顺序

1. **纯渲染类（🟢，零协议成本，收益最大）**
   Todo dock + `todo_write` 行、工具 diff、递归工具树、用户/工具图片、Skill 行、模型重试行、回合过程折叠、
   系统提示词行、回合导航轨、转录密度、轨迹视图、会话层级面包屑、内容搜索前端、分组/排序视图选项、待处理标记点
2. **事件驱动面板（🟢/🟡）**
   GoalBar、后台任务 jobs、Deliverables 挂回合、上下文注入细分、回合用量/耗时面板、队列编辑与 steer、
   会话重命名/归档/侧栏 Fork、工作区文件树 + 文档预览（含 PDF）
3. **协议先行的重功能（🔴）**
   Subagent 目录与续聊、消息级反馈、Schedule（Web 默认未启用，可最后）、模型供应商/插件配置/preset 创作器、
   `@` 文件与会话引用、Cordis 面板

> 备注：本清单基于 `dsh` 0.1.5-rc.1 web profile 全部 41 个 `dsh-client-ui-*` 包 + 跨切客户端包
> （`dsh-client-ui-layout`/`-chat`/`-tool`/`-conversation`/`-input-trigger`/`-reference`/`-attachment`、
> `dsh-api-session-controller`、`dsh-token-meter`、`dsh-session-stats`、`dsh-session-turn-outline` 等）
> 与手机端 `react-native/src`、`packages/bridge`、`packages/bridge-protocol` 现状逐项核对。

---

# 附：移动端形态适配（Mobile UX Adaptation）

上面第 1–8 节是「Web 有什么、手机端缺什么」的功能差异。这一节把每个缺口映射成**手机端该长什么样**——
Web 的三栏/浮层/hover 体系不能照搬，需要换成单列 + 底部 sheet + 全屏页。

## 形态映射总则

| Web 形态 | 手机端形态 | 理由 |
|---|---|---|
| 三栏 AppFrame + 拖拽分栏 | 单列 + 左侧抽屉（已有）+ 右侧内容改为**全屏页或底部 sheet** | 手机宽度不足以分栏 |
| 右侧栏 Files / 文档预览 tab | **全屏预览页**（顶部返回 + 类型化渲染） | 阅读面积优先 |
| 会话头 hover popover | 会话头 icon → **底部 sheet** | 无 hover，点按弹出 |
| composer 上方 GoalBar / To-do dock | **同一 dock 区**：Goal 条常驻可折叠，To-do 折叠在下方 | 复用纵向空间，避免双层占位 |
| 视图 Tab（Chat / Trajectory） | 会话页顶部**分段控件**切换（对话 / 轨迹） | 移动端常见 |
| 拖拽排序 / 拖拽分栏 | **行长按菜单**（重命名/归档/fork/置顶）+ 上下移动 | 无鼠标拖拽 |
| hover 复制卡 | **长按复制** | 触屏替代 |
| 键盘快捷键（Cmd+Enter 等） | 不适用；保留 **Enter 发送 / 排队 vs 打断** 语义 + 发送按钮长按切换 | 无物理键盘 |
| 拖拽文件到输入框 | **系统分享入口** + 相册/文件选择器 | 移动端标准 |
| Open In…（本机应用） | 改为**「在电脑上打开」/ 系统分享** | 手机无这些桌面应用 |

## 逐项适配

### 对话与 Agent 能力

| 缺口 | 移动端落点 | 依赖 | 优先级 |
|---|---|---|---|
| 1.1.1 GoalBar | composer 上方常驻条：目标一句话 + 阶段点 + 展开看进度；Pause/Resume/Edit/Clear 放展开区或长按菜单 | 🟢 | P1 |
| 1.1.2 Plan 模式 | composer 工具条的 Plan chip（选中态高亮）；`/plan` 仍可用 | 🟡 | P1 |
| 1.1.3 Plan review | composer 接管卡片，底部三个按钮：Approve / Refuse / 聊一聊 | 🟡 | P1 |
| 1.1.4 To-do dock | 与 Goal 同 dock 区，折叠行「待办 3/7」→ 展开清单 | 🟢 | P1 |
| 1.1.5 todo 工具行 | 在对话流里渲染成清单卡（不占 dock） | 🟢 | P1 |
| 1.1.6 Subagent | 会话头 `x 子代理` → Sheet 列表；点进子会话可续聊 | ✅ 目录已落地（续聊路由=打开会话） | P2 |
| 1.1.7 Workflow | 对话流内持久卡片：run 名 + 阶段进度 + 成员展开 | 🟡 | P2 |
| 1.1.8 消息反馈 | **消息长按 action sheet** 增加 👍/👎；分类对话框用底部 sheet | ✅ 已落地 | P2 |
| 1.1.9 Cordis | 设置里一个入口 + 对话流工具卡；审批走 takeover | 🔴 | P3 |
| 1.1.10 Jobs | 会话头 icon（带数量徽标）→ 底部 sheet 列表 | ✅ 已落地 | P2 |
| 1.1.11 Schedule | 会话头 icon → 底部 sheet（Web 默认未启用，可 P3） | 🔴 | P3 |
| 1.1.12 会话导出 | 会话信息 sheet 里「导出/分享」→ 系统分享 | 🟡 | P3 |
| 1.1.13 Trajectory | **全屏轨迹页**：分段控件「对话 / 轨迹」；时间线做成可纵向滚动的步骤列表，点击看明细（触屏不做缩放手势，改为列表 + 筛选） | 🟢 | P1 |
| 1.2.1 工具 diff | 工具卡展开内渲染 diff 行（红绿底），点「全屏」进 diff 页 | 🟢 | P1 |
| 1.2.2 递归工具树 | 工具卡内缩进子调用，默认折叠 | 🟢 | P1 |
| 1.2.4 用户消息图片 | 时间线真图 + 点按灯箱 | 🟡 | P1 |
| 1.2.5 工具结果图片 | 工具卡内小图网格 + 点按灯箱 | 🟢 | P2 |
| 1.2.6 Skill 行 | 工具卡变体：技能名 + 展开看 Instructions | 🟢 | P1 |
| 1.2.7 Deliverables | 回合尾「变更文件」chips（横向滚动）+ 点按进预览页；present 交付卡 | 🟢 | P1 |
| 1.2.8 system prompt 行 | 折叠行，展开看正文 | 🟢 | P2 |
| 1.2.9 回合过程折叠 | 回合头可折叠，显示工具/消息计数 | 🟢 | P1 |
| 1.2.10 模型重试行 | 时间线内联状态行 | 🟢 | P2 |
| 1.2.13 回到顶部/底部 | 对话页右下浮动按钮；历史分页下拉加载 | 🟡 | P2 |
| 1.2.14/15 用量耗时 | 回合尾点开 → 底部 sheet 明细；会话信息 sheet 保留 | 🟢 | P2 |
| 1.2.16 手动压缩 | `/compact` 命令卡 + 压缩状态行 | 🟢 | P1 |
| 1.2.18 转录密度 | 设置项：对话显示 标准/紧凑 | 🟢 | P2 |
| 1.2.19 队列编辑 | 队列 sheet：每行可编辑/删除/打断 | 🟡 | P1 |
| 1.2.20 Enter 行为 | 设置项「发送时机」：排队 / 打断 | 🟡 | P2 |

### 输入与引用

| 缺口 | 移动端落点 | 依赖 | 优先级 |
|---|---|---|---|
| 3.1 @ 文件引用 | 触发菜单底部 sheet，分组：命令 / 文件与目录 / 会话 / 技能；选择后插入 chip | 🔴 | P2 |
| 3.2/3.3 @ 会话 / 子代理 | 同上分组 | ✅ 会话已落地；子代理走会话头目录 | P2 |
| 3.5 / 技能源 | 同上「技能」分组 | ✅ 已落地 | P2 |
| 3.8 通用文件附件 | composer 附件条：图片缩略图 + 文件卡（名称/大小）+ 进度/重试 | 🟡 | P1 |
| 3.9 图片灯箱 | 全屏 modal 图片查看 | 🟢 | P2 |

### 文件与预览

| 缺口 | 移动端落点 | 依赖 | 优先级 |
|---|---|---|---|
| 4.1 工作区文件树 | 「作品」升级为文件浏览器：面包屑 + 列表（目录可进/文件可点） | 🟢 | P1 |
| 4.2 文档预览 | 全屏预览页：Markdown 渲染 / 代码高亮 / 图片 / PDF / HTML / 纯文本 | 🟡（PDF 需补白名单） | P1 |
| 4.4 面板呈现 | 一律全屏页（<768 无分栏） | 🟢 | P1 |

### 设置

| 缺口 | 移动端落点 | 依赖 | 优先级 |
|---|---|---|---|
| 5.1 模型供应商 | ✅ 凭据读写已落地；provider 目录编辑待做 | 🔴 部分待做 | P2 |
| 5.2 插件配置 | ✅ 只读清单 + JSON 写回（CAS）已落地；表单化编辑待做 | 🟢 可用 | P2 |
| 5.3 Agent preset | 设置 → 预设 → 列表 + 新建/复制/删除 | 🔴 | P3 |
| 5.4 打开配置文件 | 设置 → 关于 → 「在电脑上打开配置」 | 🟡 | P3 |
| 5.5 连接指示 | 已对齐（现有在线/重试） | 🟢 | — |

### 审批与提问

| 缺口 | 移动端落点 | 依赖 | 优先级 |
|---|---|---|---|
| 6.1 审批详情 | 接管卡内「查看详情」展开工具入参与 diff（全屏） | 🟡 | P1 |
| 6.2 多问题导航 | 接管卡顶部进度 `2/5` + 上一题/下一题 + 跳过 | 🟡 | P2 |
| 6.4 待处理标记 | 侧栏行琥珀点（审批/计划/提问） | 🟢 | P2 |

### 会话导航

| 缺口 | 移动端落点 | 依赖 | 优先级 |
|---|---|---|---|
| 2.1 会话血缘 | 会话头面包屑（祖先会话可点回跳） | ✅ 已落地 | P2 |
| 2.2/2.3 重命名 / 归档 | 行长按菜单新增两项 | 🟡 | P2 |
| 2.4 侧栏 Fork | 行长按菜单新增「在此分叉」 | 🟢 | P2 |
| 2.6/2.7 分组排序 / 分页 | 侧栏视图选项 sheet + 「显示更多」 | 🟢 | P3 |
| 2.8 内容搜索 | 侧栏搜索框扩到正文搜索 | ✅ 已落地 | P2 |
| 2.12 Open In | 改为「在电脑上打开」/分享 | 🟡 | P3 |

## 建议的移动端落地批次

- **批次 1（纯渲染，零协议成本）**：轨迹页、工具 diff、递归工具树、Todo dock + todo 卡、Skill 卡、Deliverables chips、回合折叠、模型重试行、用户/工具图片、压缩状态、队列编辑 UI
- **批次 2（事件驱动）**：GoalBar、Plan chip + review、Jobs sheet、文件浏览器 + 文档预览、会话血缘、待处理标记、内容搜索
- **批次 3（协议先行）**：Subagent 树、消息反馈、模型供应商/插件设置、@ 文件引用、Schedule、Cordis

> 依附说明：批次 1 全部可以在 `reducer.ts` 现有事件流上直接做；批次 2 中标注 🟡 的需要 bridge 补字段或帧；
> 批次 3 需要先扩 `packages/bridge` 的 RPC 白名单与宿主 Remote 对接。

---

# 附二：实现进度（手机端）

## 已完成

| 缺口 | 实现 | 位置 |
|---|---|---|
| 1.1.4/1.1.5 待办 | To-do dock（composer 上方，折叠进度）+ `todo_write` 工具卡清单 | `reducer.ts` `Composer.tsx` `ConversationScreen.tsx` |
| 1.1.13 轨迹 | 全屏轨迹页：概览卡 + 步骤列表 + 工具耗时/状态，会话头入口 | `screens/TrajectoryScreen.tsx` `trajectory.ts` |
| 1.2.1 工具 diff | 逐行 diff（增绿删红、上下文折叠、超长降级）+ `+N −N` 统计 | `toolPresentation.ts` `ConversationScreen.tsx` |
| 1.2.6 Skill 行 | 技能名展示 | 同上 |
| 1.2.7 交付文件 | `present` 工具卡列出交付文件；**回合尾「变更文件」chips，点按复制路径** | 同上 `reducer.ts` |
| 1.2.9 回合过程折叠 | 按回合分组；过程可折叠，**最后一条 assistant 与回合尾恒常显**，进行中的回合默认展开 | `turns.ts` `ConversationScreen.tsx` |
| 6.1 审批详情 | 接管卡「查看详情」展开工具入参，edit/write 渲染 diff | `adapter-dsh.ts` `ConversationScreen.tsx` |
| 5.4 Agent preset 查看 | 只读：`list()` 的 `trust/broken/path` + 读取组成文件正文（截断 4000 字符）→ 预设卡片「内置/自定义」徽标 + 不可用原因 + 可展开组成 | `presets.ts` `adapter-dsh.ts` `SettingsScreens.tsx` |
| 5.2 设置写入（CAS） | 全链路：`settings.update(ns, patch, expectedRevision)` → App 命名空间 JSON 编辑（本地 JSON 校验、冲突时回传当前修订号、含密钥字段的命名空间**强制只读**以防打码占位值覆盖真实密钥） | `settings.ts` `adapter-dsh.ts` `hub.ts` `WorkerConfigScreen.tsx` |
| 5.1 凭据写入 | 全链路：`credentials.set/unset` → App「Worker 配置」设置/更新/删除密钥（值 `secureTextEntry`、提交后立即清空本地明文、`ref` 长度与值长度双端校验） | `settings.ts` `adapter-dsh.ts` `hub.ts` `WorkerConfigScreen.tsx` |
| 5.1/5.2 设置（只读） | 全链路：`settings.describe({redactSecrets:true})` + `credentials.listRecords()` → `settings.describe` RPC → 「Worker 配置」页：凭据记录（只有 key/kind，**不下发密钥值**）、设置命名空间（生效时机/修订/是否覆盖/值预览） | `settings.ts` `adapter-dsh.ts` `hub.ts` `WorkerConfigScreen.tsx` |
| 3.2 `@` 会话引用 | `@` 菜单新增「会话」分组（匹配标题/路径、排除当前会话与子代理，最多 5 条），点选插入 `@标题` | `Composer.tsx` |
| 3.5 `/` 技能源 | 全链路：`ctx.skills.list(cwd)` → `skills.list` RPC → `/` 菜单「技能」分组（最多 8 条，点选插入 `/name ` 不直接执行） | `skills.ts` `adapter-dsh.ts` `hub.ts` `Composer.tsx` |
| 2.8 内容搜索 | 全链路：侧栏搜索 250ms 防抖 → Worker 侧 `sessionQuery.searchSessions` 跨会话全文检索 → 「正文匹配」区展示片段/工作区/在线点，点开即进入会话 | `search.ts` `adapter-dsh.ts` `hub.ts` `WorkerSidebar.tsx` |
| 3.1 `@` 文件引用 | `@` 菜单升级为**工作区文件浏览器**（复用 `fs.list`）：面包屑逐级进入、目录可钻取、文件插入相对路径；含空格路径按 Web 约定加引号 `@"a b.ts"` | `reference.ts` `Composer.tsx` |
| 2.1 会话血缘 | bridge 暴露 `parentSession/origin/delegationDepth/agentPreset`；会话头面包屑可回跳来源会话 | `adapter-dsh.ts` `reducer.ts` `HomeShellScreen.tsx` |
| 1.1.6 Subagent（目录） | 子代理会话不进侧栏（父行显数量徽标）；会话头「n 个子代理」→ Sheet 列表（深度/活动态），点开即续聊 | 同上 `WorkerSidebar.tsx` |
| 1.1.8 消息级反馈 | 全链路：👍/👎（再点即撤销）+ 负反馈分类（7 类，顺序对齐 Web）+ 备注；`ctx.messageFeedback` list/put/delete，CAS version | `feedback.ts` `adapter-dsh.ts` `hub.ts` `ConversationScreen.tsx` |
| 1.1.10 后台任务 Jobs | 全链路：`ctx.jobs` → jobs 帧/RPC → 会话头入口（进行中徽标）→ 面板（状态/耗时/detail，运行时每秒刷新） | `jobs.ts` `adapter-dsh.ts` `hub.ts` `HomeShellScreen.tsx` |
| 1.1.3 Plan review | 计划评审接管卡：`detail` 渲染 Markdown，按 `intent.approve` 批准/否决 | `server-requests.ts` `adapter-dsh.ts` `ConversationScreen.tsx` |
| 6.2 多问题导航 | 完整题目下发：`header/detail/options{label,description}/multiSelect`；上一题/下一题/跳过/提交 | 同上 |
| 1.2.10 模型重试 | `llm/retry` 可见提示行 | `reducer.ts` |
| 1.2.19 队列编辑 | 队列 Sheet：编辑/保存/取消/删除 | `Composer.tsx` |
| 1.1.1 GoalBar | 目标条：阶段、受阻原因、回合进度、暂停/继续/清除（`/goal pause|resume|clear`） | `reducer.ts` `Composer.tsx` |
| 1.1.2 Plan chip | 计划开关（`/plan`、`/plan off`） | `reducer.ts` `Composer.tsx` |
| 4.2 文档预览 | Markdown 原生渲染 / 代码高亮 / HTML·图片 WebView / 纯文本回落 | `WorkspaceArtifactsSheet.tsx` `lib/preview-kind.ts` `lib/base64.ts` |

## 仍未做（含受限原因）

| 缺口 | 状态 |
|---|---|
| 1.2.4 用户消息真图 | 需 bridge 回读附件 ref（🟡） |
| 6.1 审批详情 | ✅ 已落地：bridge 按 `callId` 回查 `tool/call` 入参，App 复用工具呈现层（edit/write 直接出 diff） |
| 2.2 Schedule | 需 schedule catalog（🔴） |
| 1.1.6 Subagent | ✅ 目录已落地（依赖 bridge 暴露 header 字段） |
| 3.1 `@` 文件引用 | ✅ 已落地（复用 `fs.list`；跨工作区搜索与 @会话/@技能 分组待做） |
| 4.2 PDF | bridge 预览白名单未含 pdf；且 RN WebView 对 data URI PDF 支持不可靠，需先定渲染方案（🟡） |
| 5.1–5.3 设置类 | 需 settings/credentials/preset Remote（🔴） |

---

# 附三：收尾状态与两项有意保留

## 已落地（按批次）

- **迁移**：全部界面 RNR + Uniwind（neutral），旧 `theme/tokens`、`theme/styles`、`design-system` shims 已删除；`tsc` 0 错、`expo export` 通过是每轮的固定闸门。
- **批次 1（纯渲染）**：轨迹全屏页、工具卡 diff/待办/技能/交付、Todo dock、队列编辑、模型重试与系统消息可见行、回合过程折叠、交付文件 chips。
- **批次 2（事件驱动）**：GoalBar、Plan chip + 计划评审、文档预览（Markdown/代码/HTML/图片/文本）、会话血缘 + Subagent 目录、审批详情、多问题导航、内容搜索。
- **批次 3（协议先行）**：后台任务 Jobs、消息级反馈、`@` 文件与会话引用、`/` 技能源、Worker 配置只读、凭据读写、设置命名空间 JSON 写回（CAS）。

## 有意保留（附理由）

1. **provider 表单化编辑**（Base URL / 模型目录 / 添加自定义 provider）
   底层 `settings.update`（CAS）与凭据读写都已打通，用户当前可在「Worker 配置」里直接编辑相关命名空间的 JSON。按 provider schema 生成原生表单属于体验优化，不是能力缺口。

2. **Agent preset 新建 / 复制 / 删除**
   `dsh-agent-presets` 的 `copyComposition` / `deleteComposition` 需要宿主 **preset 根目录**（服务私有字段 `resolvedRoots`）与文件系统写/删权限。从手机端越过公开 API 去操作电脑上的 preset 目录，风险（误删、跨版本破坏）高于收益；预设的**选择**与**组成查看**已可用。若要补齐，建议在 `dsh-agent-presets` 暴露官方 authoring remote 后再接。

## 结论

除上述两项外，`docs/web-parity-gaps.md` 正文清单中的功能均已在手机端以移动形态落地并被测试覆盖。
