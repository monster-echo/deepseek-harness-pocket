import React, { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { AuthProviderIcon } from './AuthProviderIcon';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { useApp } from '../state/AppStore';

WebBrowser.maybeCompleteAuthSession();

/**
 * 应用自身的 URL scheme（app.json 的 expo.scheme 首项）。
 *
 * 这里曾经硬编码成 Expo 模板的 `mobilestarter`：既让 Expo 每次 render 都告警
 * （LogBox 横幅「Open debugger to view warnings.」就是它刷出来的），
 * 又会让 OAuth 回调指向一个未注册的 scheme，社交登录在真机上回调不回来。
 */
function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  if (Array.isArray(scheme)) return scheme[0] ?? 'dshcompanion';
  return typeof scheme === 'string' && scheme.length > 0 ? scheme : 'dshcompanion';
}

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
  layout = 'icons',
}: Readonly<{
  onBeforeAuthenticate?: () => boolean;
  /**
   * `icons`：分隔线 + 一排圆形图标（注册等次级页面）
   * `stack`：整行描边按钮（登录首屏，Apple / Google 在前）
   */
  layout?: 'icons' | 'stack';
}>) {
  const {
    authProviders,
    authProviderPolicy,
    authProviderConfig,
    navigate,
    socialSignIn,
    showToast,
  } = useApp();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const redirectUri = useMemo(
    () => AuthSession.makeRedirectUri({ scheme: appScheme(), path: 'oauth' }),
    [],
  );
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

  const apple = authProviderPolicy.apple ? (
    <AuthProviderIcon
      enabled={authProviders.apple && appleAvailable && Platform.OS === 'ios'}
      label="Apple"
      name="apple"
      variant={layout === 'stack' ? 'button' : 'icon'}
      onPress={() => void signInWithApple()}
    />
  ) : null;
  const google = authProviderPolicy.google ? (
    <AuthProviderIcon
      enabled={authProviders.google}
      label="Google"
      name="google"
      variant={layout === 'stack' ? 'button' : 'icon'}
      onPress={() => {
        if (!onBeforeAuthenticate || onBeforeAuthenticate()) void promptGoogle();
      }}
    />
  ) : null;
  const github = authProviderPolicy.github ? (
    <AuthProviderIcon
      enabled={authProviders.github}
      label="GitHub"
      name="github"
      variant={layout === 'stack' ? 'button' : 'icon'}
      onPress={() => {
        if (!onBeforeAuthenticate || onBeforeAuthenticate()) void promptGitHub();
      }}
    />
  ) : null;
  const phone = authProviderPolicy.phone ? (
    <AuthProviderIcon
      enabled={authProviders.phone}
      label="手机号"
      name="phone"
      variant={layout === 'stack' ? 'button' : 'icon'}
      onPress={() => {
        if (!onBeforeAuthenticate || onBeforeAuthenticate()) navigate('auth.phone');
      }}
    />
  ) : null;

  if (layout === 'stack') {
    // 登录首屏：Apple / Google 优先整行，其余第三方与手机号跟随在后
    return (
      <View className="gap-2">
        {apple}
        {google}
        {github}
        {phone}
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className="flex-row items-center">
        <Separator className="flex-1" />
        <Text className="text-muted-foreground px-3 text-xs">其他登录方式</Text>
        <Separator className="flex-1" />
      </View>
      <View className="flex-row justify-center gap-5">
        {apple}
        {google}
        {github}
        {phone}
      </View>
    </View>
  );
}
