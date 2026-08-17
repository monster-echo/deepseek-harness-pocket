import { RuntimeConfig } from '../domain/models';
import { AppRoute } from './routes';

type GuardContext = Readonly<{
  signedIn: boolean;
  features: RuntimeConfig['features'];
}>;

export type RouteDecision = Readonly<{
  route: AppRoute;
  pending?: AppRoute;
  unavailable?: boolean;
}>;

const protectedRoutes = new Set<AppRoute>([
  'profile.edit', 'profile.statistics', 'profile.invite', 'profile.coupons',
  'membership.checkout', 'membership.orders', 'notifications.center',
  'settings.accountSecurity', 'settings.devices', 'settings.deleteAccount',
]);

export function guardRoute(route: AppRoute, context: GuardContext): RouteDecision {
  if (protectedRoutes.has(route) && !context.signedIn) {
    return { route: 'auth.signIn', pending: route };
  }
  if (!featureAllows(route, context.features)) {
    return { route: 'home', unavailable: true };
  }
  return { route };
}

function featureAllows(route: AppRoute, features: RuntimeConfig['features']) {
  if (route.startsWith('membership.')) return features.membership;
  if (route === 'notifications.center') return features.notifications;
  if (route === 'profile.edit') return features.profileEditing;
  if (route === 'profile.statistics') return features.statistics;
  if (route === 'profile.coupons') return features.coupons;
  if (route === 'profile.invite') return features.invites;
  if (route === 'settings.deleteAccount') return features.accountDeletion;
  return true;
}
