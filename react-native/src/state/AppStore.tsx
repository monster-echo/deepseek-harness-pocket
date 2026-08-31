import React, {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { apiClient, ApiClientError, registerSessionExpiredHandler } from '../data/apiClient';
import { clearAuthStorage, readCachedConfig, saveCachedConfig } from '../data/storage';
import { embeddedConfig } from '../config/embeddedConfig';
import {
  AppUser,
  AuthProviderConfig,
  AuthProviderPolicy,
  AuthProviders,
  OrderView,
  RuntimeConfig,
  UserSettings,
} from '../domain/models';
import { AppRoute } from '../navigation/routes';
import { EntrySource } from '../navigation/useEntryIntents';
import { guardRoute } from '../navigation/routeGuards';
import { telemetry } from '../telemetry/Telemetry';
import { defaultProviderPolicy, defaultProviders } from '../auth/authDefaults';
import { DataActions, useDataActions } from './useDataActions';
import {
  Credentials, SocialCredentials, useAccountActions,
} from './useAccountActions';
import { ConfirmState, ToastState, useFeedbackState } from './useAppShellState';
import { navigationRef, navigateRoute } from '../navigation/navigationRef';
type ToastTone = 'success' | 'info' | 'error';
export type { ToastState } from './useAppShellState';

// 购买流程的当前状态。success/failed 携带服务器确认后的订单（真实 order.status）。
export type PurchaseState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; order: OrderView }
  | { kind: 'failed'; order: OrderView }
  | { kind: 'error'; message: string }
  | { kind: 'offline' }
  | { kind: 'unauthorized' };

type AppContextValue = Readonly<{
  route: AppRoute;
  canGoBack: boolean;
  signedIn: boolean;
  user: AppUser | null;
  config: RuntimeConfig;
  authProviders: AuthProviders;
  authProviderConfig: AuthProviderConfig;
  authProviderPolicy: AuthProviderPolicy;
  online: boolean;
  bootstrapped: boolean;
  busy: boolean;
  purchaseState: PurchaseState;
  setPurchaseState: (state: PurchaseState) => void;
  pendingPlanId: string | null;
  setPendingPlanId: (planId: string | null) => void;
  toast: ToastState | null;
  confirm: ConfirmState | null;
  lastAuthError: string | null;
  clearAuthError: () => void;
  navigate: (route: AppRoute) => void;
  replace: (route: AppRoute) => void;
  back: () => void;
  signIn: (credentials: Credentials) => Promise<boolean>;
  signUp: (credentials: Credentials) => Promise<boolean>;
  socialSignIn: (credentials: SocialCredentials) => Promise<boolean>;
  requestPhoneCode: (phone: string) => Promise<boolean>;
  verifyPhoneCode: (phone: string, code: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  signOutAll: () => Promise<void>;
  updateProfile: DataActions['updateProfile'];
  saveSettings: (patch: UserSettings) => Promise<boolean>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  deleteAccount: (password: string) => Promise<boolean>;
  purchase: (planId: string) => Promise<boolean>;
  loadSessions: DataActions['loadSessions'];
  revokeSession: DataActions['revokeSession'];
  loadNotifications: DataActions['loadNotifications'];
  markNotificationsRead: DataActions['markNotificationsRead'];
  markNotificationRead: DataActions['markNotificationRead'];
  deleteNotification: DataActions['deleteNotification'];
  loadOrders: DataActions['loadOrders'];
  loadUsage: DataActions['loadUsage'];
  loadCoupons: DataActions['loadCoupons'];
  loadReferral: DataActions['loadReferral'];
  refreshBootstrap: () => Promise<void>;
  showToast: (message: string, tone?: ToastTone) => void;
  showConfirm: (state: ConfirmState) => void;
  closeConfirm: () => void;
  openEntryRoute: (route: AppRoute, cold: boolean, source?: EntrySource) => void;
}>;

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: Readonly<{ children: ReactNode }>) {
  const feedback = useFeedbackState();
  const [user, setUser] = useState<AppUser | null>(null);
  const [config, setConfig] = useState<RuntimeConfig>(embeddedConfig);
  const [authProviders, setAuthProviders] = useState(defaultProviders);
  const [authProviderConfig, setAuthProviderConfig] = useState<AuthProviderConfig>({});
  const [authProviderPolicy, setAuthProviderPolicy] = useState(defaultProviderPolicy);
  const [online, setOnline] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>({ kind: 'idle' });
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [pendingRoute, setPendingRoute] = useState<AppRoute | null>(null);
  // 最近一次请求失败的错误信息（认证失败内联显示在表单，见 issue #12）。
  const [lastAuthError, setLastAuthError] = useState<string | null>(null);
  const clearAuthError = useCallback(() => setLastAuthError(null), []);

  const refreshBootstrap = useCallback(async () => {
    const cached = await readCachedConfig();
    if (cached) {
      setConfig(cached);
      void telemetry.configure(cached);
    }
    try {
      const payload = await apiClient.bootstrap();
      setConfig(payload.config);
      setUser(payload.user);
      setAuthProviders(payload.authProviders);
      setAuthProviderConfig(payload.authProviderConfig);
      setAuthProviderPolicy(payload.authProviderPolicy);
      setOnline(true);
      void telemetry.configure(payload.config);
      await saveCachedConfig(payload.config);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    // 仅初始那次 bootstrap 完成后置 bootstrapped；轮询/回前台 resume 不改动它，
    // 品牌闪屏据此判断"拉配置完成"。
    void refreshBootstrap().finally(() => setBootstrapped(true));
    const timer = setInterval(() => void refreshBootstrap(), config.cacheTtlSeconds * 1000);
    return () => clearInterval(timer);
  }, [config.cacheTtlSeconds, refreshBootstrap]);

  const run = useCallback(async <T,>(operation: () => Promise<T>) => {
    setBusy(true);
    try {
      const result = await operation();
      setOnline(true);
      setLastAuthError(null);
      return result;
    } catch (error) {
      if (!(error instanceof ApiClientError)) setOnline(false);
      const message = error instanceof Error ? error.message : '操作失败';
      // 用户可见错误必须进遥测（app_error）——catch 分支不上报则线上查不到。
      telemetry.report(error instanceof Error ? error : new Error(message));
      setLastAuthError(message);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [feedback]);

  const navigate = useCallback((route: AppRoute) => {
    const decision = guardRoute(route, { signedIn: user !== null, features: config.features });
    if (decision.pending) setPendingRoute(decision.pending);
    if (decision.unavailable) feedback.showToast('当前 App 未启用此功能', 'info');
    navigateRoute(decision.route);
  }, [config.features, feedback, user]);
  const replace = useCallback((route: AppRoute) => {
    const decision = guardRoute(route, { signedIn: user !== null, features: config.features });
    if (decision.pending) setPendingRoute(decision.pending);
    if (navigationRef.isReady()) navigationRef.reset({ routes: [{ name: decision.route }] });
  }, [config.features, user]);
  const back = useCallback(() => {
    if (navigationRef.isReady() && navigationRef.canGoBack()) navigationRef.goBack();
  }, []);
  const openEntryRoute = useCallback((
    route: AppRoute,
    cold: boolean,
    source: EntrySource = 'deepLink',
  ) => {
    const decision = guardRoute(route, { signedIn: user !== null, features: config.features });
    if (decision.pending) setPendingRoute(decision.pending);
    if (!navigationRef.isReady()) return;
    if (decision.unavailable) {
      feedback.showToast('目标内容不可用，已返回首页', 'info');
      navigationRef.reset({ routes: [{ name: 'home' }] });
      return;
    }
    if (cold) {
      navigationRef.reset({
        routes: decision.route === 'home'
          ? [{ name: 'home' }]
          : [{ name: 'home' }, { name: decision.route }],
      });
    } else {
      navigateRoute(decision.route);
    }
    telemetry.track('entry_open', {
      route,
      source,
      launchState: cold ? 'cold' : 'warm',
    });
  }, [config.features, feedback, user]);
  const actions = useAccountActions({
    run,
    setUser,
    onAuthenticated: () => {
      setPurchaseState({ kind: 'idle' });
      const target = pendingRoute ?? 'home';
      setPendingRoute(null);
      if (navigationRef.isReady()) navigationRef.reset({ routes: [{ name: target }] });
    },
    onSignedOut: () => {
      setPurchaseState({ kind: 'idle' });
      replace('home');
    },
    showToast: feedback.showToast,
  });
  useEffect(() => {
    registerSessionExpiredHandler(() => {
      console.log('[AUTH-DEBUG] sessionExpiredHandler: clearing user + storage');
      setUser(null);
      void clearAuthStorage();
      if (navigationRef.isReady()) {
        navigationRef.reset({ routes: [{ name: 'auth.signIn' }] });
      }
    });
    return () => registerSessionExpiredHandler(null);
  }, []);
  const dataActions = useDataActions(run, setUser, user, setPurchaseState);
  const value = useMemo<AppContextValue>(() => ({
    route: (navigationRef.getCurrentRoute()?.name ?? 'launch.splash') as AppRoute,
    canGoBack: navigationRef.isReady() && navigationRef.canGoBack(),
    navigate,
    replace,
    back,
    ...feedback,
    ...actions,
    ...dataActions,
    signedIn: user !== null,
    user,
    config,
    authProviders,
    authProviderConfig,
    authProviderPolicy,
    online,
    bootstrapped,
    busy,
    lastAuthError,
    clearAuthError,
    purchaseState,
    setPurchaseState,
    pendingPlanId,
    setPendingPlanId,
    refreshBootstrap,
    openEntryRoute,
  }), [
    actions,
    authProviders,
    authProviderConfig,
    authProviderPolicy,
    bootstrapped,
    busy,
    pendingPlanId,
    purchaseState,
    config,
    dataActions,
    feedback,
    navigate,
    back,
    online,
    openEntryRoute,
    refreshBootstrap,
    replace,
    lastAuthError,
    clearAuthError,
    user,
  ]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
