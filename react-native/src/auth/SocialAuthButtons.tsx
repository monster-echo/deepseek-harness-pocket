import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { AuthProviderIcon } from './AuthProviderIcon';
import { useApp } from '../state/AppStore';
import { colors, spacing } from '../theme/tokens';

WebBrowser.maybeCompleteAuthSession();

const githubDiscovery = {
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  tokenEndpoint: 'https://github.com/login/oauth/access_token',
};
const googleDiscovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export function SocialAuthButtons({
  onBeforeAuthenticate,
}: Readonly<{ onBeforeAuthenticate?: () => boolean }>) {
  const {
    authProviders,
    authProviderPolicy,
    authProviderConfig,
    navigate,
    socialSignIn,
    showToast,
  } = useApp();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'mobilestarter', path: 'oauth' });
  const nonce = useMemo(() => Crypto.randomUUID(), []);
  const githubId = authProviderConfig.github?.clientId ?? 'not-configured';
  const googleId = authProviderConfig.google?.clientId ?? 'not-configured';
  const [githubRequest, githubResponse, promptGitHub] = AuthSession.useAuthRequest({
    clientId: githubId,
    redirectUri,
    scopes: ['read:user', 'user:email'],
    usePKCE: true,
  }, githubDiscovery);
  const [, googleResponse, promptGoogle] = AuthSession.useAuthRequest({
    clientId: googleId,
    redirectUri,
    responseType: AuthSession.ResponseType.IdToken,
    scopes: ['openid', 'profile', 'email'],
    usePKCE: false,
    extraParams: { nonce },
  }, googleDiscovery);

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  useEffect(() => {
    if (githubResponse?.type === 'success' && githubRequest?.codeVerifier) {
      void socialSignIn({
        provider: 'github',
        authorizationCode: githubResponse.params.code,
        redirectUri,
        codeVerifier: githubRequest.codeVerifier,
      });
    } else if (githubResponse?.type === 'error') {
      showToast('GitHub 授权失败，请重试', 'error');
    }
  }, [githubRequest, githubResponse, redirectUri, showToast, socialSignIn]);

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      void socialSignIn({
        provider: 'google',
        idToken: googleResponse.params.id_token,
        nonce,
      });
    } else if (googleResponse?.type === 'error') {
      showToast('Google 授权失败，请重试', 'error');
    }
  }, [googleResponse, showToast, socialSignIn]);

  const signInWithApple = async () => {
    if (onBeforeAuthenticate && !onBeforeAuthenticate()) return;
    try {
      const result = await AppleAuthentication.signInAsync({
        nonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (result.identityToken) {
        await socialSignIn({ provider: 'apple', idToken: result.identityToken, nonce });
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        showToast('Apple 登录失败，请重试', 'error');
      }
    }
  };

  const visible = authProviderPolicy.apple
    || authProviderPolicy.google
    || authProviderPolicy.github
    || authProviderPolicy.phone;
  if (!visible) return null;
  return (
    <View style={socialStyles.section}>
      <View style={socialStyles.divider}>
        <View style={socialStyles.line} />
        <Text style={socialStyles.caption}>其他登录方式</Text>
        <View style={socialStyles.line} />
      </View>
      <View style={socialStyles.row}>
      {authProviderPolicy.apple ? (
        <AuthProviderIcon
          enabled={authProviders.apple && appleAvailable && Platform.OS === 'ios'}
          label="Apple"
          name="apple"
          onPress={() => void signInWithApple()}
        />
      ) : null}
      {authProviderPolicy.google ? (
        <AuthProviderIcon
          enabled={authProviders.google}
          label="Google"
          name="google"
          onPress={() => {
            if (!onBeforeAuthenticate || onBeforeAuthenticate()) void promptGoogle();
          }}
        />
      ) : null}
      {authProviderPolicy.github ? (
        <AuthProviderIcon
          enabled={authProviders.github}
          label="GitHub"
          name="github"
          onPress={() => {
            if (!onBeforeAuthenticate || onBeforeAuthenticate()) void promptGitHub();
          }}
        />
      ) : null}
      {authProviderPolicy.phone ? (
        <AuthProviderIcon
          enabled={authProviders.phone}
          label="手机号"
          name="phone"
          onPress={() => {
            if (!onBeforeAuthenticate || onBeforeAuthenticate()) navigate('auth.phone');
          }}
        />
      ) : null}
      </View>
    </View>
  );
}

const socialStyles = StyleSheet.create({
  section: { gap: spacing.x3 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  caption: { color: colors.textSecondary, fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.x4 },
});
