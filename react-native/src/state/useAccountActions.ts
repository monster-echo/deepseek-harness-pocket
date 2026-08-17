import { useMemo } from 'react';
import { apiClient } from '../data/apiClient';
import {
  clearAuthStorage,
  clearNonEssentialStorage,
  saveRefreshToken,
  saveSessionToken,
} from '../data/storage';
import { AppUser } from '../domain/models';

export type Credentials = Readonly<{
  email: string;
  password: string;
  username?: string;
  consentVersion?: string;
}>;
export type SocialCredentials = Readonly<{
  provider: 'apple' | 'google' | 'github';
  idToken?: string;
  authorizationCode?: string;
  redirectUri?: string;
  codeVerifier?: string;
  nonce?: string;
}>;

type Input = Readonly<{
  run: <T>(operation: () => Promise<T>) => Promise<T>;
  setUser: React.Dispatch<React.SetStateAction<AppUser | null>>;
  onAuthenticated: () => void;
  onSignedOut: () => void;
  showToast: (message: string, tone?: 'success' | 'info' | 'error') => void;
}>;

export function useAccountActions(input: Input) {
  return useMemo(() => {
    const acceptSession = async (
      result: Awaited<ReturnType<typeof apiClient.signIn>>,
      message: string,
    ) => {
      await saveSessionToken(result.token);
      await saveRefreshToken(result.refreshToken);
      input.setUser(result.user);
      input.showToast(message, 'success');
      input.onAuthenticated();
    };
    const authenticate = async (credentials: Credentials, create: boolean) => {
      try {
        const result = await input.run(() => create
          ? apiClient.signUp(
            credentials.email,
            credentials.password,
            credentials.username ?? '',
            credentials.consentVersion ?? '',
          )
          : apiClient.signIn(credentials.email, credentials.password));
        await acceptSession(result, create ? '账号创建成功' : '登录成功');
        return true;
      } catch {
        return false;
      }
    };
    const signOut = async () => {
      try {
        await input.run(apiClient.signOut);
      } catch {
        input.showToast('服务端会话暂未撤销，本机凭据已清除', 'error');
      }
      await clearAuthStorage();
      input.setUser(null);
      input.onSignedOut();
    };
    const signOutAll = async () => {
      try {
        await input.run(apiClient.signOutAll);
      } catch {
        input.showToast('服务端会话暂未撤销，本机凭据已清除', 'error');
      }
      await clearAuthStorage();
      await clearNonEssentialStorage();
      input.setUser(null);
      input.onSignedOut();
    };
    return {
      signIn: (credentials: Credentials) => authenticate(credentials, false),
      signUp: (credentials: Credentials) => authenticate(credentials, true),
      socialSignIn: async (credentials: SocialCredentials) => {
        try {
          const result = await input.run(() => apiClient.socialSignIn(credentials));
          await acceptSession(result, '登录成功');
          return true;
        } catch { return false; }
      },
      requestPhoneCode: async (phone: string) => {
        try {
          await input.run(() => apiClient.requestPhoneCode(phone));
          return true;
        } catch { return false; }
      },
      verifyPhoneCode: async (phone: string, code: string) => {
        try {
          const result = await input.run(() => apiClient.verifyPhoneCode(phone, code));
          await acceptSession(result, '手机号登录成功');
          return true;
        } catch { return false; }
      },
      signOut,
      signOutAll,
    };
  }, [input]);
}
