import { createNavigationContainerRef } from '@react-navigation/native';
import type { AppRoute } from './routes';

// Every route takes no params. AuthScreen mode and PreferenceScreen kind are
// derived from the route name inside the screen wrapper (AuthRoute/PreferenceRoute),
// not passed as nav params — keeps RootParamList uniform.
export type RootParamList = { [K in AppRoute]: undefined };

// Imperative navigation handle. AppStore.navigate/replace/back forward to this
// ref so existing useApp().navigate(...) call sites work unchanged after the
// migration to @react-navigation (issue #2: real native stack keeps source
// screens alive on push).
export const navigationRef = createNavigationContainerRef<RootParamList>();

type PendingCommand =
  | { readonly kind: 'reset'; readonly name: AppRoute }
  | { readonly kind: 'navigate'; readonly name: AppRoute };

/**
 * 容器未就绪时的导航命令队列。
 *
 * 之前 `isReady()` 不成立就**静默丢弃**命令，调用方（如启动页 `enterApp`）
 * 却在调用前就把 `doneRef` 置位，于是导航再也发不出去 —— 表现为永久卡在启动页。
 * 现在统一排队，容器 `onReady` 时补发。
 */
const pending: PendingCommand[] = [];

function enqueue(command: PendingCommand): void {
  // 同一目标只保留最后一条，避免冷启动期间堆积
  const existing = pending.findIndex((c) => c.kind === command.kind);
  if (existing >= 0) pending.splice(existing, 1);
  pending.push(command);
}

function run(command: PendingCommand): void {
  if (command.kind === 'reset') {
    navigationRef.reset({ routes: [{ name: command.name }] });
  } else {
    navigationRef.navigate(command.name as never);
  }
}

/** NavigationContainer 的 `onReady` 调用：补发排队中的导航命令。 */
export function drainPendingNavigation(): void {
  if (pending.length === 0) return;
  const queued = pending.splice(0, pending.length);
  for (const command of queued) {
    if (navigationRef.isReady()) run(command);
    else pending.push(command);
  }
}

/** @react-navigation 的 navigate() 重载要求字面量路由名，这里集中收敛类型断言。 */
export function navigateRoute(name: AppRoute): void {
  if (navigationRef.isReady()) navigationRef.navigate(name as never);
  else enqueue({ kind: 'navigate', name });
}

/** 重置到单一目标路由（启动页分流、登录态切换用）。 */
export function resetRoute(name: AppRoute): void {
  if (navigationRef.isReady()) navigationRef.reset({ routes: [{ name }] });
  else enqueue({ kind: 'reset', name });
}
