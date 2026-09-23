# 手机端 UI 迁移规范（RNR + Uniwind）

> **状态：迁移已完成。** `react-native/src` 下所有界面均在 RNR + Uniwind 上，
> 旧 `theme/tokens.ts`、`theme/styles.ts`、`design-system/components.tsx`、
> `design-system/componentStyles.ts` 已删除。本文件保留作为后续写界面的规范。

本项目把 `react-native/` 的全部界面从「自研 `theme/tokens` + `StyleSheet`」迁移到
**react-native-reusables（RNR）+ Uniwind + Tailwind v4**，主题用 RNR 默认 neutral。

## 已完成的地基（不要修改这些文件）

| 路径 | 说明 |
|---|---|
| `src/global.css` | Uniwind 入口 + neutral 主题变量（`--color-*`） |
| `metro.config.js` / `tsconfig.json` | 已接 Uniwind，别名 `@/* → src/*` |
| `src/lib/utils.ts` | `cn()` |
| `src/lib/nav-theme.ts` | React Navigation 主题 |
| `src/components/ui/*` | RNR 组件（从官方 registry 生成，勿手改） |
| `src/components/blocks/*` | RNR blocks |
| `src/design-system/AppIcon.tsx` | `AppIcon`（底层 lucide，保留旧 `IconName`） |
| `src/design-system/components.tsx` | 兼容外壳：`AppButton/PageHeader/AppCard/ListRow/ToggleRow/IconButton/OfflineBanner`（内部已是 RNR） |
| `src/design-system/Sheet.tsx` | Bottom Sheet 容器（@gorhom，配色走 CSS 变量） |
| `App.tsx` / `src/preferences/PreferencesProvider.tsx` | 已接 `PortalHost`、`Uniwind.setTheme` |

## 迁移规则

1. **只改你负责的文件**，不要动上面「已完成地基」里的共享文件。
2. **视觉层换成 className**：
   - 颜色：`bg-background` `bg-card` `bg-muted` `text-foreground` `text-muted-foreground`
     `border-border` `text-primary` `bg-primary` `text-destructive` `bg-destructive` 等。
   - 明暗用 `dark:` 变体，**不要**再读 `palette` / `darkColors`。
   - 间距/圆角/字号走 Tailwind（`gap-3` `p-4` `rounded-lg` `text-sm` `font-bold`）。
3. **优先直接用 RNR 组件**：`@/components/ui/{button,text,card,input,label,separator,badge,avatar,dialog,alert-dialog,dropdown-menu,tabs,switch,checkbox,select,progress,radio-group,tooltip,popover,collapsible,accordion,skeleton,alert,textarea,toggle,toggle-group}`。
   - `Button` 的正文必须包 `<Text>`；`Button` variant：`default | destructive | outline | secondary | ghost | link`。
   - 图标用 `import { Icon } from '@/components/ui/icon'` + `lucide-react-native`，
     或沿用 `AppIcon`（旧 `IconName`）。
4. **业务逻辑一行都不许改**：状态、hooks、RPC 调用、导航、telemetry、testID、accessibilityLabel 全部保留。
5. **不要新增 `StyleSheet.create`**；确实需要动态值时用内联对象（但优先找 className 表达）。
6. 若某处必须保留命令式颜色（如 @gorhom、WebView、SVG fill），用
   `useCSSVariable('--color-foreground')` 等 CSS 变量，不要 import `theme/tokens`。
7. 保留 `export` 的名字与签名，路由/调用方不受影响。
8. 完成后必须让 `cd react-native && npx tsc --noEmit` 保持 **0 error**。

## 反面模式（不要这样写）

```tsx
// ❌ 旧写法
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, spacing } from '../theme/tokens';
const { palette } = usePreferences();
<View style={{ backgroundColor: palette.surface, padding: spacing.x4 }} />
<Text style={{ color: palette.text }}>标题</Text>

// ✅ 新写法
<View className="bg-card p-4">
  <Text className="text-foreground">标题</Text>
</View>
```

## 迁移后的两条注意事项

1. **字体大小设置**：Uniwind/Tailwind 的字号在构建期固定，RN 样式不接受运行时 `calc()`，
   所以 `设置 → 字体大小` 无法靠 CSS 变量缩放。当前在会话正文（Markdown 内联样式）与
   Composer 输入框上按 `usePreferences().textScale` 显式相乘恢复该设置。
   若要把缩放扩展到全 app，需要在各文本处显式应用，或改用可变的字号 token 方案。
2. **第三方组件不支持 className**：`react-native-keyboard-controller` 的 `KeyboardAvoidingView`、
   `Animated.View`、WebView 等 Uniwind 未包装的组件，`className` 会被忽略，
   必须用内联 `style` + `useCSSVariable('--color-*')`。
