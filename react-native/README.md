# react-native/ — 掌鲸手机端

Expo 应用。UI 体系已从自研 `theme/tokens + StyleSheet` 迁移到
**react-native-reusables（RNR）+ Uniwind + Tailwind v4**，主题使用 RNR 默认 neutral。

## 快速开始

```sh
cp .env.example .env
npm install
npx expo start
```

## UI 体系

| 层 | 位置 | 说明 |
|---|---|---|
| 样式底座 | `src/global.css` + `metro.config.js` | Uniwind 接管 Tailwind；`withUniwindConfig` 必须是最外层 metro 包装 |
| 组件 | `src/components/ui/*` | RNR 官方 registry 生成，**不要手改**；改需求请重新生成或就地覆盖 |
| 区块 | `src/components/blocks/*` | RNR 认证类 block |
| 组合工具 | `src/lib/utils.ts` | `cn()`（clsx + tailwind-merge） |
| 导航主题 | `src/lib/nav-theme.ts` | React Navigation 主题，取值对齐 `--color-*` |
| 图标 | `lucide-react-native` + `src/design-system/AppIcon.tsx` | `AppIcon` 是旧 `IconName` 的兼容层，内部走 lucide |
| 底部弹层 | `src/design-system/Sheet.tsx` | @gorhom/bottom-sheet 容器（RNR 无 sheet 原语），配色走 CSS 变量 |

### 写界面的规则

- 用 `className` 表达样式：`bg-background` `bg-card` `text-foreground` `text-muted-foreground`
  `border-border` `bg-primary` `text-destructive`；明暗用 `dark:` 变体。
- 不要新增 `StyleSheet.create`，不要读 `palette` / `theme/tokens`。
- 必须拿命令式颜色时（SVG fill、WebView、@gorhom）用 `useCSSVariable('--color-foreground')`。
- 业务逻辑、`testID`、`accessibilityLabel`、导出的 props 签名保持不变。

完整迁移规范见 [`../docs/ui-migration-brief.md`](../docs/ui-migration-brief.md)。

## 主题

`PreferencesProvider` 把用户偏好（跟随系统 / 浅色 / 深色）同步给 `Uniwind.setTheme`，
颜色全部来自 `src/global.css` 的 `--color-*` 变量（neutral 调色板）。当前没有品牌色注入，
如需换肤改 `global.css` 即可，组件层无需改动。

## 组件生成

`src/components/ui` 由脚本从 RNR 官方 registry 拉取并改写 import 路径：

```sh
npm run rnr:fetch            # 需要外网；本机可走代理 https_proxy=http://127.0.0.1:7897
```

要新增组件，编辑 `scripts/fetch-rnr.mjs` 的 `COMPONENTS` 列表后重跑。
也可以直接用官方 CLI：`npx @react-native-reusables/cli@latest add <component>`（需先有 `components.json`）。

## 命令

```sh
npm run typecheck   # tsc --noEmit，必须 0 error
npm test            # vitest
npm run rnr:fetch   # 重新拉取 RNR 组件
```

## 打包验证

改动 UI 底座后建议跑一次真实打包（比 tsc 更能暴露 Uniwind 转换问题）：

```sh
npx expo export --platform ios --output-dir /tmp/expo-verify
```
