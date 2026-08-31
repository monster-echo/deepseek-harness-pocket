import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { NavigationContainer } from '@react-navigation/native';
// 注意：必须用 safe-area-context 的 SafeAreaView（RN 内置的在 Android 上是 no-op，
// 且 SDK 57 edge-to-edge 下内容会画进状态栏/手势条）。
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { AppRoute } from './src/navigation/routes';
import { AppProvider } from './src/state/AppStore';
import { FeedbackHost } from './src/design-system/FeedbackHost';
import { styles } from './src/theme/styles';
import { telemetry } from './src/telemetry/Telemetry';
import { AppErrorBoundary } from './src/telemetry/AppErrorBoundary';
import { SupportProvider } from './src/support/SupportStore';
import { AuthRecoveryProvider } from './src/auth/AuthRecoveryStore';
import { PreferencesProvider } from './src/preferences/PreferencesProvider';
import { usePreferences } from './src/preferences/PreferencesProvider';
import { useApp } from './src/state/AppStore';
import { useEntryIntents } from './src/navigation/useEntryIntents';
import { setPlatformHeader } from './src/data/runtimePlatform';

// 在生产 App 入口注入平台标识，apiClient 通过 getPlatformHeader() 在请求时读取，
// 使 HTTP 层不依赖 react-native 模块（node 可测试）。
setPlatformHeader(Platform.OS);

// 保持原生启动屏直到 JS 首帧渲染完成：避免冷启动时原生 splash 被瞬间替换的闪跳，
// 并遮住 expo-dev-client 下载 JS bundle 的过程（开发构建特有）。
void ExpoSplashScreen.preventAutoHideAsync();

export default function App() {
  return (
    <AppErrorBoundary>
      <AppProvider>
        <PreferencesProvider>
          <AuthRecoveryProvider>
            <SupportProvider>
              <AppSurface />
            </SupportProvider>
          </AuthRecoveryProvider>
        </PreferencesProvider>
      </AppProvider>
    </AppErrorBoundary>
  );
}

function AppSurface() {
  const { palette } = usePreferences();
  const { openEntryRoute, refreshBootstrap } = useApp();
  const resume = useCallback(() => { void refreshBootstrap(); }, [refreshBootstrap]);
  useEntryIntents(openEntryRoute, resume);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <KeyboardProvider>
    <SafeAreaProvider>
      <BottomSheetModalProvider>
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: palette.background }]}
        edges={['top', 'bottom']}
      >
        <NavigationContainer
          ref={navigationRef}
          onStateChange={() => {
            // Screen-view telemetry fires on every navigation state change
            // (push/pop/replace/tab switch). Replaces the old
            // useEffect([navigation.route]) in AppStore.
            const current = navigationRef.getCurrentRoute();
            if (current?.name) telemetry.screen(current.name as AppRoute);
          }}
        >
          <RootNavigator />
        </NavigationContainer>
        <FeedbackHost />
      </SafeAreaView>
      </BottomSheetModalProvider>
    </SafeAreaProvider>
    </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
