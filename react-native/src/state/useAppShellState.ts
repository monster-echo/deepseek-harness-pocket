import { useCallback, useMemo, useState } from 'react';
import { AppRoute, RouteEntry } from '../navigation/routes';

type ToastTone = 'success' | 'info' | 'error';
export type ToastState = Readonly<{ id: number; message: string; tone: ToastTone }>;
export type ConfirmState = Readonly<{
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}>;

let routeKey = 0;

export function useNavigationState() {
  const [stack, setStack] = useState<RouteEntry[]>([
    { key: 'route-0', name: 'launch.splash' },
  ]);
  const navigate = useCallback((name: AppRoute) => {
    routeKey += 1;
    setStack((current) => [...current, { key: `route-${routeKey}`, name }]);
  }, []);
  const replace = useCallback((name: AppRoute) => {
    routeKey += 1;
    setStack([{ key: `route-${routeKey}`, name }]);
  }, []);
  const replaceTop = useCallback((name: AppRoute) => {
    routeKey += 1;
    setStack((current) => [
      ...current.slice(0, -1),
      { key: `route-${routeKey}`, name },
    ]);
  }, []);
  const openEntry = useCallback((name: AppRoute, cold: boolean) => {
    routeKey += 1;
    const entry = { key: `route-${routeKey}`, name };
    setStack((current) => {
      if (current[current.length - 1]?.name === name) return current;
      if (cold) {
        const home = { key: `route-${routeKey}-home`, name: 'home' as AppRoute };
        return name === 'home' ? [home] : [home, entry];
      }
      return [...current, entry];
    });
  }, []);
  const back = useCallback(() => {
    setStack((current) => current.length > 1 ? current.slice(0, -1) : current);
  }, []);
  return useMemo(() => ({
    route: stack[stack.length - 1].name,
    canGoBack: stack.length > 1,
    navigate,
    replace,
    replaceTop,
    openEntry,
    back,
  }), [back, navigate, openEntry, replace, replaceTop, stack]);
}

export function useFeedbackState() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now();
    setToast({ id, message, tone });
    setTimeout(() => setToast((value) => value?.id === id ? null : value), 2400);
  }, []);
  return useMemo(() => ({
    toast,
    confirm,
    showToast,
    showConfirm: setConfirm,
    closeConfirm: () => setConfirm(null),
  }), [confirm, showToast, toast]);
}
