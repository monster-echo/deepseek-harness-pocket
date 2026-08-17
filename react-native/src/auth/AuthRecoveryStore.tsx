import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { apiClient } from '../data/apiClient';
import { useApp } from '../state/AppStore';

type AuthRecoveryContextValue = Readonly<{
  email: string;
  busy: boolean;
  resendAvailableAt: number;
  requestCode: (email: string) => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  resetPassword: (password: string) => Promise<boolean>;
}>;

const AuthRecoveryContext = createContext<AuthRecoveryContextValue | null>(null);

export function AuthRecoveryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { navigate, replace, showToast } = useApp();
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);

  const requestCode = useCallback(async (value: string) => {
    if (busy || Date.now() < resendAvailableAt) return false;
    setBusy(true);
    try {
      const result = await apiClient.requestPasswordReset(value);
      setEmail(value.trim().toLowerCase());
      setResendAvailableAt(Date.now() + result.resendAfterSeconds * 1000);
      showToast('如果账号存在，验证码已经发送', 'success');
      navigate('auth.verifyEmail');
      return true;
    } catch (error) {
      showToast(errorMessage(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, navigate, resendAvailableAt, showToast]);

  const verifyCode = useCallback(async (code: string) => {
    if (busy || !email) return false;
    setBusy(true);
    try {
      const result = await apiClient.verifyPasswordReset(email, code);
      setResetToken(result.resetToken);
      navigate('auth.resetPassword');
      return true;
    } catch (error) {
      showToast(errorMessage(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, email, navigate, showToast]);

  const resetPassword = useCallback(async (password: string) => {
    if (busy || !resetToken) return false;
    setBusy(true);
    try {
      await apiClient.resetPassword(resetToken, password);
      setResetToken('');
      showToast('密码已经更新，请重新登录', 'success');
      replace('auth.signIn');
      return true;
    } catch (error) {
      showToast(errorMessage(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, replace, resetToken, showToast]);

  const value = useMemo<AuthRecoveryContextValue>(() => ({
    email,
    busy,
    resendAvailableAt,
    requestCode,
    verifyCode,
    resetPassword,
  }), [
    busy,
    email,
    requestCode,
    resendAvailableAt,
    resetPassword,
    verifyCode,
  ]);
  return (
    <AuthRecoveryContext.Provider value={value}>
      {children}
    </AuthRecoveryContext.Provider>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

export function useAuthRecovery() {
  const value = useContext(AuthRecoveryContext);
  if (!value) throw new Error('useAuthRecovery must be used inside AuthRecoveryProvider');
  return value;
}
