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

// @react-navigation's navigate() overloads require a literal route name; a
// dynamic union (AppRoute) won't satisfy them, so this helper centralizes the
// cast. See https://reactnavigation.org/docs/typescript.
export function navigateRoute(name: AppRoute): void {
  if (navigationRef.isReady()) navigationRef.navigate(name as never);
}
