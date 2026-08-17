import { useEffect, useRef } from 'react';
import { AppState, Linking } from 'react-native';
import { AppRoute } from './routes';

export type EntrySource = 'notification' | 'deepLink';

const routeNames = new Set<AppRoute>([
  'home', 'profile.home', 'profile.edit', 'profile.statistics', 'profile.invite',
  'profile.coupons', 'membership.home', 'membership.plans', 'membership.orders',
  'settings.home', 'settings.accountSecurity', 'settings.devices',
  'settings.notifications', 'settings.privacy', 'settings.general',
  'settings.appearance', 'settings.language', 'settings.textSize',
  'settings.storage', 'settings.permissions', 'settings.helpFeedback',
  'settings.legal', 'settings.privacyPolicy', 'settings.termsOfService',
  'settings.about', 'notifications.center', 'support.newTicket',
]);

export function useEntryIntents(
  open: (route: AppRoute, cold: boolean, source: EntrySource) => void,
  resume: () => void,
) {
  const initialHandled = useRef(false);
  const previousState = useRef(AppState.currentState);
  useEffect(() => {
    if (!initialHandled.current) {
      initialHandled.current = true;
      void Linking.getInitialURL().then((url) => {
        const intent = parseEntryUrl(url);
        if (intent) open(intent.route, true, intent.source);
      });
    }
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      const intent = parseEntryUrl(url);
      if (intent) open(intent.route, false, intent.source);
    });
    const stateSubscription = AppState.addEventListener('change', (state) => {
      const restoring = previousState.current !== 'active' && state === 'active';
      previousState.current = state;
      if (restoring) resume();
    });
    return () => {
      linkSubscription.remove();
      stateSubscription.remove();
    };
  }, [open, resume]);
}

export function parseEntryUrl(url: string | null) {
  if (!url) return null;
  const source: EntrySource = url.includes('source=notification') ? 'notification' : 'deepLink';
  const match = url.match(/[?&]route=([^&#]+)/);
  const pathMatch = url.match(/\/([^/?#]+)(?:[?#]|$)/);
  const route = decodeURIComponent(match?.[1] ?? pathMatch?.[1] ?? '');
  if (!routeNames.has(route as AppRoute)) return null;
  return { route: route as AppRoute, source };
}
