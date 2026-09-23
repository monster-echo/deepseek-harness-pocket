/**
 * React Navigation 主题：映射 RNR（shadcn neutral）的 CSS 变量取值。
 *
 * 与 src/global.css 中的 --color-* 保持一致；Uniwind 负责组件层明暗，
 * 这里只负责导航容器自身的背景/边框/文字色，避免切换时内部闪白。
 */
import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: 'oklch(1 0 0)',
      border: 'oklch(0.922 0 0)',
      card: 'oklch(1 0 0)',
      notification: 'oklch(0.577 0.245 27.325)',
      primary: 'oklch(0.205 0 0)',
      text: 'oklch(0.145 0 0)',
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: 'oklch(0.145 0 0)',
      border: 'oklch(1 0 0 / 10%)',
      card: 'oklch(0.205 0 0)',
      notification: 'oklch(0.704 0.191 22.216)',
      primary: 'oklch(0.922 0 0)',
      text: 'oklch(0.985 0 0)',
    },
  },
};
