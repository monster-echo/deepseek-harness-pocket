/**
 * Firebase 已从本产品移除（备案合规 + 启动崩溃修复）。
 * telemetry 的动态 import 仅在 firebaseMode='client_direct' 时触达（本产品恒为
 * 'disabled'）；这里保留类型声明使 tsc 通过，运行时 import 会失败并被既有
 * try/catch 吞掉。
 */
declare module '@react-native-firebase/analytics' {
  export function getAnalytics(): unknown
  export function setAnalyticsCollectionEnabled(instance: unknown, enabled: boolean): Promise<void>
  export function logEvent(instance: unknown, name: string, params?: Record<string, unknown>): Promise<void>
}

declare module '@react-native-firebase/crashlytics' {
  export function getCrashlytics(): unknown
  export function setCrashlyticsCollectionEnabled(instance: unknown, enabled: boolean): Promise<void>
}

declare module '@react-native-firebase/crashlytics' {
  export function getCrashlytics(): unknown
  export function setCrashlyticsCollectionEnabled(instance: unknown, enabled: boolean): Promise<void>
  export function setAttribute(instance: unknown, key: string, value: string): Promise<void>
  export function recordError(instance: unknown, error: Error): Promise<void>
}
