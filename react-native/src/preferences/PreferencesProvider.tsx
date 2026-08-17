import React, { createContext, ReactNode, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../state/AppStore';
import { colors, darkColors, ThemeColors } from '../theme/tokens';
import { applyTheme } from '../theme/styles';

type ThemeMode = 'system' | 'light' | 'dark';
type Locale = 'zh-CN' | 'en-US';

type PreferencesValue = Readonly<{
  locale: Locale;
  mode: ThemeMode;
  dark: boolean;
  palette: ThemeColors;
  textScale: number;
  text: (key: TranslationKey) => string;
}>;

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { user } = useApp();
  const systemScheme = useColorScheme();
  const mode = normalizeTheme(user?.settings.theme);
  const locale = user?.settings.language === 'en-US' ? 'en-US' : 'zh-CN';
  const dark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const palette = dark ? darkColors : colors;
  const textScale = normalizeTextScale(user?.settings.textScale);
  applyTheme(palette, textScale);
  const value: PreferencesValue = {
    locale,
    mode,
    dark,
    palette,
    textScale,
    text: (key) => translations[locale][key],
  };
  return (
    <PreferencesContext.Provider value={value}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function normalizeTextScale(value: unknown) {
  if (typeof value !== 'number') return 1;
  return Math.min(1.3, Math.max(0.9, value));
}

const translations = {
  'zh-CN': {
    settings: '设置', accountServices: '账户与服务', accountSecurity: '账户与安全',
    devices: '登录设备管理', membership: '会员与订阅', appPreferences: '应用偏好',
    notifications: '通知设置', general: '通用设置', appearance: '外观主题',
    language: '语言', textSize: '字体大小', privacySupport: '隐私、存储与支持',
    privacy: '隐私设置', permissions: '权限管理', storage: '存储与缓存',
    help: '帮助与反馈', legal: '协议与政策', about: '关于与版本',
    deleteAccount: '注销账号', system: '跟随系统', light: '浅色', dark: '深色',
    chinese: '简体中文', english: 'English', selected: '已选择',
    save: '保存设置', saving: '保存中…', saved: '设置已同步到服务端',
    guest: '未登录用户', signInSync: '登录后同步跨设备设置',
  },
  'en-US': {
    settings: 'Settings', accountServices: 'Account & services', accountSecurity: 'Account & security',
    devices: 'Signed-in devices', membership: 'Membership & billing', appPreferences: 'App preferences',
    notifications: 'Notifications', general: 'General', appearance: 'Appearance',
    language: 'Language', textSize: 'Text size', privacySupport: 'Privacy, storage & support',
    privacy: 'Privacy', permissions: 'Permissions', storage: 'Storage & cache',
    help: 'Help & feedback', legal: 'Legal & policies', about: 'About',
    deleteAccount: 'Delete account', system: 'Use system setting', light: 'Light', dark: 'Dark',
    chinese: '简体中文', english: 'English', selected: 'Selected',
    save: 'Save settings', saving: 'Saving…', saved: 'Settings synced',
    guest: 'Guest', signInSync: 'Sign in to sync settings across devices',
  },
} as const;

export type TranslationKey = keyof typeof translations['zh-CN'];
