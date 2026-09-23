# 手机端 UI 重设计 · 分析 + 落地方案

> 输入：`docs/design/exec-*.png` 21 张新设计稿（853×1844，iPhone 15 Pro 比例）
> 对象：`react-native/`（Expo 57 / RN 0.86 / RNR + Uniwind + Tailwind v4）
> 基线：`npx tsc --noEmit` = 0 error；功能面按 `docs/web-parity-gaps.md` 附三已收尾
> 结论一句话：**这是一次"视觉语言重写 + 运行中心/Worker 详情两处结构新增"，不是功能重做。**
>
> ⚠️ **风格口径（你的最新指示）**：视觉统一走 **shadcn/ui 样式风格**。
> 设计稿只提供信息架构与内容参考；具体观感以 shadcn 默认主题为准
> （`rounded-lg/xl + border + bg-card + shadow-sm`，primary 近黑、muted 分组底），
> **不采用** iOS 原生那套 grouped inset / 大圆角毛玻璃观感。

---

## 0. 已确认的决策（来自你的回复）

| 议题 | 决定 |
|---|---|
| **样式风格** | **shadcn/ui 风格**（覆盖设计稿的 iOS 观感）；primary 走 shadcn 中性近黑，蓝色只作可选强调 |
| 首页形态 | **保留现有「顶栏 + 抽屉」结构**，只重画视觉（不改信息架构、不动导航路径与测试） |
| 本轮范围 | **批次 0–2**：设计令牌 + 原语组件 + P0 核心面 |
| 协议改动 | **允许**动 `packages/bridge*`（Worker 指标、job 进度/停止），UI 与协议并行 |
| 暗色模式 | 按**语义 token 映射一套暗色**（设计稿只有浅色） |

### 0.1 重要澄清：设计稿 ≠ 完整设计（登录页作废）

你已明确：**设计稿 #1 的登录页不符合要求**，以你的口述为准：

- ❌ 不要「使用 DeepSeek 账号登录」
- ❌ 不要「使用企业账号」
- ❌ 不要「其他方式 → 使用代码登录 Worker」这一组
- ✅ **用我们自己的账号体系**
- ✅ **支持 Apple 登录、Google 登录**

对照现有代码，这些能力**已经具备**，只是登录页没有把它们摆出来：

| 能力 | 位置 | 当前默认 |
|---|---|---|
| 账号密码（自有账号） | `AuthScreen` `signIn` / `signUp` | 开 |
| 手机号 | `auth.phone` | 开 |
| Apple | `SocialAuthButtons` + `expo-apple-authentication`（`app.json` `usesAppleSignIn: true`） | 远端开关 `authProviderPolicy.apple = false` |
| Google | `SocialAuthButtons`（expo-auth-session + id_token） | 远端开关 `false` |
| GitHub | 同上 | 远端开关 `false` |
| 微信 | `defaultProviders.wechat` | 远端开关 `false` |

→ 登录页重设计**只做一件事**：把「自有账号 + Apple + Google」按品牌规范排出来，
provider 可见性继续吃 `authProviderPolicy`（远端开关），不写死。

### 0.2 品牌与文案

- app 显示名：**掌鲸 DSH Pocket**（`app.json`），slug `dshcompanion`，bundle id 同源
- 设计稿里用的是 `deepseek HARNESS` 字标 + 「Harness 随身端」+「由 DeepSeek 驱动」
- ❓**待你定**：新界面用哪套字标与副标题？（`assets/brand/` 里现只有 logo/logo-dark）
  在确认前，登录页按「自有品牌占位 + 可一行替换」实现。

### 0.3 其余待澄清（第一帧）

| # | 问题 | 影响 |
|---|---|---|
| Q1 | app 冷启第一帧是**继续上次的会话**，还是**先停在首页/抽屉**？ | 决定启动路由与首帧骨架 |
| Q2 | 首页「通知」红点数字来自现有通知中心还是实时事件？ | 决定徽标数据源（🟢 现有） |
| Q3 | 「正在查找你的 Worker」出现在**每次进入选设备**时，还是**仅首次配对**？ | 决定是否新增该页 |

---

## 一、设计稿清单（21 张 → 22 个界面态）

| # | 文件 | 界面 | 现状对应 | 状态 |
|---|---|---|---|---|
| 1 | `22cb836e` | 登录首屏 | `screens/AuthScreens.tsx` `signIn` | ⚠️ **作废重做**（见 0.1） |
| 2 | `c8e1f8e2` | 正在查找你的 Worker（雷达 + 探测列表） | `features/onboarding/PairWorkerScreen.tsx` | 待定 Q3 |
| 3 | `85619477` | 选择 Worker（列表 + 勾选 + 添加） | 新增（现为 `WorkerSwitchSheet`） | 采信 |
| 4 | `c84188cf` | 侧边栏/首页（logo + Worker 卡 + 新会话 + 工作区树 + 通知/设置） | `WorkerSidebar.tsx` + `HomeShellScreen.tsx` | 采信（**只换皮**） |
| 5 | `25556778` | 新会话（Worker 卡 + 工作区卡 + 大输入框 + 4 行配置 + 创建会话） | `Composer.tsx` 新会话态 | 采信 |
| 6 | `54b6ae70` | 会话对话（思考折叠 + 工具卡 + 清单 + 新 composer） | `ConversationScreen.tsx` | 采信 |
| 7 | `7bb29882` | 轨迹（筛选 chips + 纵向时间线） | `screens/TrajectoryScreen.tsx` | 采信 |
| 8 | `900688b1` | 添加与执行 action sheet（2 列宫格） | `Composer.tsx` 附件/命令入口 | 采信 |
| 9 | `00446143` | 运行中心（分栏 + 运行中/等待确认/已完成） | 新增（现为只读单会话 Jobs Sheet） | 采信（需协议） |
| 10 | `53816a0f` | Worker 详情（CPU/内存/心跳 + 管理 + 安全） | 新增（无此页） | 采信（需协议） |
| 11 | `6ad2d9c2` | 会话菜单 sheet | `SessionInfoSheet.tsx` | 采信 |
| 12 | `99fdc4f4` | 确认操作（高权限审批） | 审批接管卡 | 采信 |
| 13 | `9ee61dd4` | 设置（6 组分组列表） | `screens/SettingsScreens.tsx` | 采信 |
| 14 | `c8eb68e7` | 我的（资料卡 + 需要处理 + 我的 Worker + 行组 + 退出登录） | `screens/ProfileScreens.tsx` | 采信 |
| 15 | `289d57c9` | Agent 预设（4 卡片单选 + 自定义） | `SettingsScreens` 预设区 | 采信 |
| 16 | `350631ae` | 插件（搜索 + 已安装 + 查看可用） | `SettingsScreens` 插件区 | 采信 |
| 17 | `2937a963` | 工具详情（flutter test：终端输出 + 元信息） | 新增（现为工具卡展开） | 采信 |
| 18 | `cbce35cd` | 文件（目录浏览 + 多选操作条） | `WorkspaceArtifactsSheet.tsx` | 采信 |
| 19 | `fba84423` | 选择工作区文件（树形多选 + 已选 chip） | `DirectoryPickerSheet.tsx` | 采信 |
| 20 | `e9b7536d` | 通知中心（分栏 + 按天分组） | `notifications/` + 通知屏 | 采信 |
| 21 | `acf0697b` | 插件/设置子页 | `SettingsUtilityScreens.tsx` | 采信 |

---

## 二、设计语言诊断：与现状的差距

### 2.1 视觉规范（全局，影响每一个文件）

| 维度 | 现状（RNR neutral / shadcn 味） | 设计稿（iOS 原生味） | 影响面 |
|---|---|---|---|
| 主色 | `--color-primary` = 近黑 `oklch(0.205 0 0)` | 蓝 `#0A6CFF` 系（按钮/链接/选中/发送键） | 全局 |
| 页面底色 | `bg-background` 纯白，卡片也纯白 | 页面 `#F2F2F7` 浅灰，卡片纯白浮起 | 51+38 处 |
| 分隔线 | `border-border` 1px 描边卡片（155 处） | 分组内缩进发丝线，卡片无描边、靠底色反差 + 圆角 12–22px | 155 处 |
| 表单行 | 卡片套卡片 | **Grouped Inset List**：`组标题 + 白卡 + 缩进分隔线 + 右值/箭头` | 全部设置/我的/Worker 页 |
| 图标 | lucide `size-[17px]` 灰 | 32–40px **圆角色块 + 彩色字形**（蓝/紫/橙/绿/青）语义色彩系统 | 全局 |
| 强调态 | primary 反白按钮 | 蓝实心 / 蓝描边 / 浅蓝底三种；危险态红字红底 | 全局 |
| 圆角层次 | `rounded-xl` 为主，10px 基础 | 卡片 12–16、容器 16–22、胶囊圆钮全圆 | 55+ 处 |
| 字号 | 混用 `text-base` / `text-[11px]` 零散值 | 严格层级：28/22 标题、17 正文、15 次级、13 说明、11 微 | 全部 |
| 图标字形 | lucide 直接铺 | 设计稿用**填充/彩色圆角块**图标，lucide 是线性风格 | 需统一取舍 |

### 2.2 组件缺口（现在没有、必须新建）

| 组件 | 用在哪 | 现状替代 |
|---|---|---|
| `ListGroup` / `ListRow` | 设置、我的、Worker 详情、插件、预设、通知 | 各处手写 `card + border + row`，样式不统一 |
| `SegmentedControl` | 运行中心、通知、轨迹筛选、对话/轨迹切换 | `components/ui/tabs`（Web 味，形态不符） |
| `IconBadge`（圆角彩块图标） | 全站行首图标 | 无 |
| `StatBar`（标签 + 进度条 + 数值） | Worker 详情 CPU/内存 | 有 `progress` 但形态不同 |
| `ActionSheet`（2 列宫格 + 分组标题） | 添加与执行、会话菜单 | `Sheet` + 手写行 |
| `MessageBubble` | 用户深蓝气泡 / 助手灰卡 + 头像 | `ConversationScreen` 内联 |
| `ToolCard` | 工具图标 + 标题 + 终端块/diff + 展开 | 内联 + `toolPresentation.ts` |
| `DeviceRow` | Worker 选择/查找/我的 Worker | 各处手写 |
| `Composer` 重构 | + / 输入 / 权限胶囊 / 模型胶囊 / 圆形发送 | 2336 行巨型文件 |

### 2.3 结构变化

| 变化 | 说明 |
|---|---|
| ~~首页 = 侧栏形态~~ | **不改**（你已定：保留顶栏 + 抽屉）。设计稿 #4 的抽屉内容用于**重画现有抽屉**：Worker 卡、全宽「新会话」、工作区/会话树、底部通知/设置 |
| 新增「选择 Worker」「查找 Worker」「Worker 详情」 | 现只有 `WorkerSwitchSheet` 与配对页，且无运行时指标页 |
| 新增「运行中心」全屏页 | 现为单会话只读 Jobs Sheet；设计稿是跨会话 + 3 状态分栏 + 进度条 + 实时输出尾 + 停止 + 允许/拒绝 |
| 对话头部信息密度提升 | 标题 + `设备 / 工作区` 副标题 + 溢出菜单 |
| 设置/我的 重排为分组列表 | 路由与条目基本齐全，只重排视觉与分组 |
| 长按/点按菜单改 sheet 形态 | 会话行 `⋯`、消息长按、附件入口统一底部 sheet |
| **登录页** | **按你的口述重做**（自有账号 + Apple + Google），不采用设计稿 #1 |

---

## 三、数据与协议缺口（已获准改动 bridge）

| 设计元素 | 需要的数据 | 现状 | 等级 |
|---|---|---|---|
| Worker 卡「macOS 14.6 · 8 核 16GB」 | `osVersion / cpuCores / memoryBytes / hostname` | `WorkerPresence` 只有 `name/hostFingerprint/online/lastSeenAt/dshVersion` | 🟡 |
| Worker 详情「CPU 32% / 内存 8.4/32GB / 最后心跳」 | 运行时指标 + 秒级刷新 | 无 | 🔴 需 worker 采集 + 新 RPC |
| 运行中心「62% 进度 + 实时输出尾 + 停止」 | job 进度、输出尾、跨会话聚合、`jobs.cancel` | `JobSnapshot` 只有 `id/kind/label/status/detail/startedAt`，按会话订阅 | 🟡 + 🔴 |
| 运行中心「等待处理：允许/拒绝」 | 跨会话审批聚合 | 审批只走 session 流 | 🟡 |
| 运行中心「已完成：退出码」 | `exitCode` | `detail` 里可能含，未结构化 | 🟡 |
| 对话「编辑 3 个文件 +52 −12」 | 每回合文件变更聚合 | 已有 edit diff / `present`，可投影 | 🟢 |
| 通知中心分栏 + 按天分组 | 通知列表结构 | 已有 `notifications/`，需核对字段 | 🟢 先核 |
| 工具详情元信息 | 工具起止时间 | `tool/call|result` 已带时间戳 | 🟢 |
| 首页工作区树 | workspace + 会话数 | 已有 | 🟢 |

---

## 四、落地方案

### 4.0 技术路线（三层，自下而上）

```
① 设计令牌层   src/global.css @theme + :root/@variant
               新增语义 token：canvas / card / hairline / accent / accent-soft /
               state-{success,warning,danger,info} / radius-{card,sheet,pill}
               保留 RNR 变量名（bg-card、text-muted-foreground…）→ 老代码自动继承新色
② 原语组件层   src/components/app/*（新目录，不手改 components/ui/*）
               ListGroup/ListRow/SegmentedControl/IconBadge/StatBar/ActionSheet/
               DeviceRow/MessageBubble/ToolCard/SectionHeader/EmptyState
③ 屏幕迁移层   逐屏替换，业务逻辑（hooks / RPC / 导航 / testID / a11y）零改动
```

**关键决策：不改 `components/ui/*`。** 那是 RNR registry 生成物（`ui-migration-brief.md` 明令勿手改）。
所有组合原语放 `components/app/*`，RNR 原语继续作为行为底座。

**shadcn 风格落法**（已体现在 `components/app/*`）：
`bg-card + border border-border + rounded-xl`（卡片）/ `rounded-lg`（按钮、输入、分段）/
`text-sm + text-xs` 层级 / `text-muted-foreground` 次要文字 / `bg-muted` 分组底 /
`active:bg-accent` 交互态 / `shadow-sm` 仅用于浮起元素。

### 4.1 工程纪律（每批都要过）

1. `cd react-native && npx tsc --noEmit` → 0 error
2. `npx vitest run` → 全绿（`reducer/trajectory/sessionView` 等断言不动）
3. `npx expo export --platform ios` → 通过（打包闸门）
4. **零业务逻辑改动**：只动 JSX 结构与 className；不碰 `reducer.ts` / `dshStore.ts` / `dsh/client.ts` / RPC 调用
5. 硬编码色审计：`.tsx` 里禁止新增 `bg-emerald-*` / `bg-amber-*` / `text-blue-*`，一律走语义 token
6. `states.gallery` 作为视觉回归页：新原语全部挂进去，一屏看全明/暗、空/加载/错误/禁用

### 4.2 批次划分

#### 批次 0 · 地基（0.5 天）
- 审计并替换硬编码色（已扫出 47 处：`amber` 18 / `emerald` 21 / `zinc·yellow·red` 4 等 → 语义 token）
- 重写 `global.css` 令牌（保留变量名，换值 + 补新 token）
- 建立 `components/app/` 目录与 `states.gallery` 挂载点

#### 批次 1 · 原语组件（1 天）✅ 已完成
- `ListGroup` / `ListRow` / `SectionHeader` / `ListSeparator` / `IconBadge`
- `SegmentedControl`（替换 `tabs`）
- `ActionSheetContent`（2 列卡片 + 整行）
- `StatBar` / `DeviceRow`
- 产出：gallery 可点、`tsc` 0 错、明/暗截图已比对

#### 批次 2 · P0 核心面（2–3 天）
| 文件 | 改动 |
|---|---|
| `screens/AuthScreens.tsx` | **按 0.1 重做登录页**（自有账号 + Apple + Google，吃 `authProviderPolicy`） |
| `features/workers/WorkerSidebar.tsx` | 抽屉重画（Worker 卡 / 新会话 / 工作区树 / 底部通知·设置·我的账户）✅ 已改 |
| `features/workers/HomeShellScreen.tsx` | 顶栏视觉对齐（**结构不变**） |
| `features/conversation/ConversationScreen.tsx` | 头部、用户气泡/助手卡、新工具卡、清单卡 |
| `features/conversation/Composer.tsx` | 输入区重构（+/输入/权限胶囊/模型胶囊/圆发送） |
| `features/workers/WorkspaceArtifactsSheet.tsx` + `DirectoryPickerSheet.tsx` | 文件浏览 + 树形多选 |
| `features/conversation/SessionInfoSheet.tsx` | 会话菜单 sheet 形态 |

#### 批次 3 · 新页面（下一轮）
`WorkerPickerScreen` / `WorkerDiscoveryScreen` / `WorkerDetailScreen` / `RunCenterScreen` / `ToolDetailScreen` + 路由注册 5 条

#### 批次 5 · 协议补齐（与批次 2 并行）
- `packages/bridge-protocol`：presence 补 `osVersion/cpuCores/memoryBytes/hostname`；`JobSnapshot` 补 `progress/exitCode/tail`；新增 `system.stats`、`jobs.cancel`、跨会话 `jobs.list`
- `packages/bridge`：`adapter-dsh.ts` 暴露上述方法

### 4.3 验收对照表

每张设计稿在 `docs/ui-redesign-checklist.md`（批次 0 产出）登记：
`设计稿 → 屏幕/组件 → 状态覆盖（空/加载/错误/长文/暗色）→ 是否通过`

### 4.4 验证方式（本环境已打通真机模拟器）

- 每批闸门：`tsc --noEmit` 0 error、`vitest run` 全绿、`expo export --platform ios` 通过
- **视觉验证已可自动化**：本机 iPhone 16 Pro 模拟器（iOS 26.4）装 Release 构建，
  `xcrun simctl` 截图明/暗两套，直接比对
- `states.gallery`（状态库 / 原语）是视觉回归页；截图素材见 `docs/ui-redesign-plan.md` 附二

> 注意：本机 8081 端口被另一个项目（LofiCompanion）的 Metro 占用，
> Debug 开发构建会误连到它的 bundle（表现为 `Cannot find native module 'ExpoLocalization'`）。
> 所以模拟器验证走 **Release 构建**（JS 打进 app，不依赖 Metro），不要用 Debug 构建排障。

---

## 五、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `Composer.tsx` 2336 行、`ConversationScreen` 1491 行 | 改动面大、易回归 | 先抽子组件再换皮，行为不变 |
| 设计稿无暗色版 | 暗色可能走形 | 语义 token 双套值；gallery 强制过暗色 |
| 设计稿图标是填充彩块，代码用 lucide 线性图标 | 观感差异明显 | 批次 1 定图标策略（彩块底 + lucide 字形），gallery 先看效果 |
| 登录页作废、其余页也可能有同类偏差 | 返工 | 每批开工前先贴「本批 1:1 对照说明」给你确认 |
| 运行中心/Worker 详情无数据 | 界面空壳 | 骨架 + 占位 + 空/加载态，协议就绪后接真数据 |

---

## 附 · 现状盘点

- 屏幕文件 17 个（`src/screens/*`）+ 功能组件 9 个（`src/features/**`）
- 路由 45 条（`navigation/routes.ts`）
- 语义类使用量：`text-muted-foreground` 316 / `border-border` 155 / `text-foreground` 137 / `text-primary` 62 / `bg-muted` 55 / `bg-background` 51 / `bg-primary` 40 / `bg-card` 38
- 硬编码色 47 处（amber 18 / emerald 21 / zinc·yellow·red 等 8），批次 0 全部收敛
- `dark:` 变体 52 处
- 基线：`tsc --noEmit` = 0 error

---

## 附二 · 实施进度

### 批次 0 · 已完成（2026-09-14）

| 项 | 落点 |
|---|---|
| 令牌重写 | `react-native/src/global.css`：**shadcn/ui 默认 neutral 主题**（primary 近黑、muted 分组底、border 描边、radius 0.625rem）；新增 `canvas / hairline / accent-soft / success / warning / info / destructive-soft / tint-* / hue-*`；保留全部 RNR 变量名（老页面 className 不改即继承新主题） |
| 硬编码色收敛 | 8 个文件共 47 处 `amber/emerald/zinc/yellow/red` 调色板类 → `warning / success / destructive` 语义类；随之产生的重复 `dark:` 变体一并清掉 |
| 原语目录 | 新增 `react-native/src/components/app/`（含 barrel `index.ts`），**不改** `components/ui/*` |
| 视觉回归页 | `components/app/DesignSystemGallery.tsx` 挂进 `states.gallery`（`screens/StateGalleryScreen.tsx`） |

### 批次 1 · 已完成（同批）

| 原语 | 文件 | 说明 |
|---|---|---|
| `ListGroup` / `ListRow` / `ListSeparator` / `SectionHeader` | `components/app/list.tsx` | shadcn 列表：`border + bg-card + rounded-xl`、行 `border-b` 分隔；行支持 icon / 副标题 / 右值 / 箭头 / 开关 / 危险态 |
| `IconBadge` | `components/app/icon-badge.tsx` | 7 色浅底图标块（`bg-tint-* + text-hue-*`），尺寸 sm/md/lg/xl |
| `SegmentedControl` | `components/app/segmented-control.tsx` | shadcn Tabs 变体：`bg-muted` 轨道 + `bg-background shadow-sm` 选中块，支持角标数字 |
| `StatBar` | `components/app/stat-bar.tsx` | 指标条（CPU / 内存），4 种色调 |
| `ActionSheetContent` / `DeviceRow` | `components/app/action-sheet.tsx` | 两列卡片 / 整行列表两种 item + 设备行 |
| 抽屉视觉 | `features/workers/WorkerSidebar.tsx` | 品牌行 + 当前电脑卡 + 新会话 + 搜索 + 工作区树 + 底部「通知/设置/我的账户」行组（**结构未改**，只换视觉） |

验证：`tsc --noEmit` 0 error；`vitest` 91 passed（12 文件 / 7 skip）；
`expo export --platform ios` 通过；**iPhone 16 Pro 模拟器 Release 构建截图比对明/暗两套已通过**
（登录页 + gallery 原语页；蓝主色→中性黑的回退已确认生效）。

验证：`tsc --noEmit` 0 error；`vitest` 91 passed（12 文件 / 7 skip）；
`expo export --platform ios` 通过；gallery 里全部原语可见。

### 批次 5（协议）· 已完成的切面

| 项 | 落点 |
|---|---|
| Worker 机器信息类型 | `WorkerHostInfo`（hostname / osVersion / cpuCores / memoryBytes / runtimeVersion） |
| 注册帧上送 | `packages/bridge/src/plugin/uplink.ts` 新增 `collectHostInfo()`（node:os 采集，失败不阻塞注册） |
| Gateway 透传 | `gateway/src/server/gateway.ts` 内存态存 `host`，`presence.host` 下发（离线或旧版插件为 null） |
| 手机端解析 | `packages/bridge-protocol/src/relay.ts` `parseHostInfo` + `WorkerPresence.host` |
| 测试 | gateway 新增 2 例（带 host 透传 / 不带 host 为 null）；protocol 50、bridge 40、gateway 14 全绿 |

> **运行中心的数据面（已把宿主侧能力摸清，落点明确）：**
> dsh `@deepseek-ai/dsh-jobs` 的 `JobSnapshot`（`lib/types/types.d.ts`）字段为
> `id / kind / label / outputLimitBytes? / ownerSession? / status / detail? / startedAt / finishedAt? / reported`；
> 并且注册表本来就提供 `read(id, caller)`（流式读取输出增量，终态后可幂等重读）与 `cancel(id)`。
> 所以运行中心要的三件事不用改 dsh，只需在 bridge 加两个 RPC：
> 1. `jobs.output(sessionId, jobId)` → 透传 `registry.read()`，得到输出尾（设计稿里的实时日志块）
> 2. `jobs.cancel(sessionId, jobId)` → 透传 `registry.cancel()`（设计稿里的「停止」）
> 3. `progress` 没有原生字段：用 `startedAt/status` 前端投影（时间进度条），或在 bash producer 侧补 detail
>
> **Worker 运行时指标**（CPU% / 内存占用 / 心跳）确实需要 worker 侧采集：建议在插件里加
> `system.stats` RPC（node:os 的 `loadavg` + `freemem` + 进程 uptime），按需拉取、不推送。

### 批次 2 · P0 核心面 · 已完成（登录页结构待定）

| 屏幕 | 状态 | 落点 |
|---|---|---|
| 抽屉 | ✅ | `features/workers/WorkerSidebar.tsx`：品牌行 + 当前电脑卡 + 新会话 + 搜索 + 工作区树 + 底部「通知/设置/我的账户」卡片行组 |
| 顶栏 / 外壳 | ✅ | `features/workers/HomeShellScreen.tsx`：`bg-background` 顶栏 + ghost 图标钮；工作区/后台任务/子代理三个 Sheet 改为卡片行组 |
| 对话 | ✅ | `features/conversation/ConversationScreen.tsx`：用户气泡 `bg-primary rounded-xl`、assistant `bg-card border rounded-xl`、思考块 `bg-muted/50`、工具/交付行 `active:bg-accent` |
| Composer | ✅ | `features/conversation/Composer.tsx`：14 处 `border-border/60` → `border-border`，5 处 `rounded-[20px]` / 4 处 `rounded-2xl` → `rounded-xl`，发送/停止按钮回归 shadcn `rounded-md size-9`，GhostChip 胶囊 → ghost 按钮 |
| 文件浏览 | ✅ | `WorkspaceArtifactsSheet.tsx`（目录/文件卡片行 + 图标块）、`DirectoryPickerSheet.tsx`（面包屑 `bg-muted`、目录列表卡片行、文件夹图标） |
| 会话菜单 | ✅ | `SessionInfoSheet.tsx`：`bg-card border rounded-xl` + 行分隔线 |
| 配对页 | ✅ | `features/onboarding/PairWorkerScreen.tsx`：改用 `DeviceRow` + `ListGroup`，安装步骤/配对码分两组 |
| 登录页 | ✅ | `screens/AuthScreens.tsx` + `auth/AuthProviderIcon.tsx` + `auth/SocialAuthButtons.tsx`：自有品牌字标「掌鲸 DSH Pocket」+ 功能副标题；**第三方整行按钮置顶**（Apple → Google → GitHub → 手机号，`layout="stack"`）；「或使用账号密码」分隔线 → 账号/密码表单 → 登录 → 「还没有账号？创建账号」；可见性仍吃 `authProviderPolicy` 远端开关，不写死 |

验证（本轮全部通过）：
`tsc --noEmit` 0 error · `vitest` 91 passed（12 文件 / 7 skip）· `expo export --platform ios` 通过
模拟器截图：登录页（明/暗）、gallery 原语页、抽屉（明）、新会话 Composer（明）

> 截图核验技巧：Release 构建 + `xcrun simctl io <sim> screenshot`，
> 再跑 `swiftc` 编个小工具用 Vision 做 OCR（`VNRecognizeTextRequest`，`zh-Hans`），
> 直接读出屏上文案，避免"看图猜屏"。本轮登录页就是用这个确认的。

### 待你拍板的小项

1. 品牌区文案：设计稿是 `deepseek HARNESS / Harness 随身端`，`app.json` 里是「掌鲸 DSH Pocket」，
   现在抽屉用后者。以哪个为准？
2. 登录页入口顺序：现在密码表单在上、社交图标在下。要不要调成「Apple/Google 在上、密码表单在下」？

