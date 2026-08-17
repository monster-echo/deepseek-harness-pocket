import React from 'react';
import { useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootParamList } from './navigationRef';

import { AuthScreen, AuthMode } from '../screens/AuthScreens';
import { HomeScreen } from '../screens/HomeScreen';
import { OnboardingScreen, SplashScreen } from '../screens/LaunchScreens';
import { EditProfileScreen, ProfileScreen } from '../screens/ProfileScreens';
import { MembershipScreen } from '../screens/MembershipScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { CouponsScreen, InviteScreen, StatisticsScreen } from '../screens/ProfileUtilityScreens';
import { AccountSecurityScreen, DevicesScreen, SettingsScreen } from '../screens/SettingsScreens';
import {
  DeleteAccountScreen,
  PreferenceScreen,
  PreferenceKind,
} from '../screens/SettingsPreferenceScreens';
import {
  LegalIndexScreen,
  PrivacyPolicyScreen,
  SubscriptionTermsScreen,
  TermsOfServiceScreen,
} from '../screens/LegalScreens';
import { StateGalleryScreen } from '../screens/StateGalleryScreen';
import { AboutScreen, NotificationsScreen, OrdersScreen } from '../screens/DataScreens';
import { SupportHomeScreen, TicketDetailScreen } from '../screens/SupportScreens';
import { NewTicketScreen, ProductFeedbackScreen } from '../screens/SupportFormScreens';
import { PermissionsScreen, StorageScreen, TextSizeScreen } from '../screens/SettingsUtilityScreens';

const Stack = createNativeStackNavigator<RootParamList>();

const AUTH_MODES: Record<string, AuthMode> = {
  'auth.signIn': 'signIn',
  'auth.signUp': 'signUp',
  'auth.phone': 'phone',
  'auth.forgotPassword': 'forgot',
  'auth.verifyEmail': 'verify',
  'auth.resetPassword': 'reset',
};

// AuthScreen takes a `mode` prop; derive it from the route name so each auth
// route reuses one component via a thin wrapper.
function AuthRoute() {
  const route = useRoute();
  return <AuthScreen mode={AUTH_MODES[route.name] ?? 'signIn'} />;
}

const PREF_KIND: Record<string, { kind: PreferenceKind; title: string }> = {
  'settings.notifications': { kind: 'notifications', title: '通知设置' },
  'settings.general': { kind: 'general', title: '通用设置' },
  'settings.privacy': { kind: 'privacy', title: '隐私设置' },
  'settings.appearance': { kind: 'appearance', title: '外观主题' },
  'settings.language': { kind: 'language', title: '语言' },
};

function PreferenceRoute() {
  const route = useRoute();
  const cfg = PREF_KIND[route.name];
  return (
    <PreferenceScreen kind={cfg?.kind ?? 'general'} title={cfg?.title ?? ''} />
  );
}

// The native stack keeps source screens mounted on push, so going back from a
// detail page does not rebuild the list (issue #2). Header is hidden — each
// screen renders its own AppHeader.
export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="launch.splash"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="launch.splash" component={SplashScreen} />
      <Stack.Screen name="launch.onboarding" component={OnboardingScreen} />
      <Stack.Screen name="home" component={HomeScreen} />

      <Stack.Screen name="auth.signIn" component={AuthRoute} />
      <Stack.Screen name="auth.signUp" component={AuthRoute} />
      <Stack.Screen name="auth.phone" component={AuthRoute} />
      <Stack.Screen name="auth.forgotPassword" component={AuthRoute} />
      <Stack.Screen name="auth.verifyEmail" component={AuthRoute} />
      <Stack.Screen name="auth.resetPassword" component={AuthRoute} />

      <Stack.Screen name="profile.home" component={ProfileScreen} />
      <Stack.Screen name="profile.edit" component={EditProfileScreen} />
      <Stack.Screen name="profile.statistics" component={StatisticsScreen} />
      <Stack.Screen name="profile.invite" component={InviteScreen} />
      <Stack.Screen name="profile.coupons" component={CouponsScreen} />

      <Stack.Screen name="membership.home" component={MembershipScreen} />
      <Stack.Screen name="membership.plans" component={MembershipScreen} />
      <Stack.Screen name="membership.checkout" component={CheckoutScreen} />
      <Stack.Screen name="membership.orders" component={OrdersScreen} />

      <Stack.Screen name="notifications.center" component={NotificationsScreen} />

      <Stack.Screen name="settings.home" component={SettingsScreen} />
      <Stack.Screen name="settings.accountSecurity" component={AccountSecurityScreen} />
      <Stack.Screen name="settings.devices" component={DevicesScreen} />
      <Stack.Screen name="settings.notifications" component={PreferenceRoute} />
      <Stack.Screen name="settings.general" component={PreferenceRoute} />
      <Stack.Screen name="settings.privacy" component={PreferenceRoute} />
      <Stack.Screen name="settings.appearance" component={PreferenceRoute} />
      <Stack.Screen name="settings.language" component={PreferenceRoute} />
      <Stack.Screen name="settings.textSize" component={TextSizeScreen} />
      <Stack.Screen name="settings.storage" component={StorageScreen} />
      <Stack.Screen name="settings.permissions" component={PermissionsScreen} />
      <Stack.Screen name="settings.legal" component={LegalIndexScreen} />
      <Stack.Screen name="settings.privacyPolicy" component={PrivacyPolicyScreen} />
      <Stack.Screen name="settings.termsOfService" component={TermsOfServiceScreen} />
      <Stack.Screen name="settings.subscriptionTerms" component={SubscriptionTermsScreen} />
      <Stack.Screen name="settings.helpFeedback" component={SupportHomeScreen} />
      <Stack.Screen name="support.newTicket" component={NewTicketScreen} />
      <Stack.Screen name="support.ticket" component={TicketDetailScreen} />
      <Stack.Screen name="support.feedback" component={ProductFeedbackScreen} />
      <Stack.Screen name="settings.about" component={AboutScreen} />
      <Stack.Screen name="settings.deleteAccount" component={DeleteAccountScreen} />
      <Stack.Screen name="states.gallery" component={StateGalleryScreen} />
    </Stack.Navigator>
  );
}
