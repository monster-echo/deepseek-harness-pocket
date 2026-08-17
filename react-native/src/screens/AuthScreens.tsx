import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppButton, PageHeader } from '../design-system/components';
import { useApp } from '../state/AppStore';
import { colors, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';
import { useAuthRecovery } from '../auth/AuthRecoveryStore';
import { SocialAuthButtons } from '../auth/SocialAuthButtons';

export type AuthMode = 'signIn' | 'signUp' | 'phone' | 'forgot' | 'verify' | 'reset';

const authCopy: Record<AuthMode, Readonly<{ title: string; action: string }>> = {
  signIn: { title: '欢迎回来', action: '登录' },
  signUp: { title: '创建账号', action: '注册' },
  phone: { title: '手机号登录', action: '发送验证码' },
  forgot: { title: '找回密码', action: '发送验证码' },
  verify: { title: '验证邮箱', action: '确认验证码' },
  reset: { title: '设置新密码', action: '确认修改' },
};

export function AuthScreen({ mode }: Readonly<{ mode: AuthMode }>) {
  const {
    navigate,
    signIn,
    signUp,
    requestPhoneCode,
    verifyPhoneCode,
    showToast,
    busy: accountBusy,
    config,
    lastAuthError,
    clearAuthError,
  } = useApp();
  const recovery = useAuthRecovery();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('+86');
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const copy = authCopy[mode];
  const busy = accountBusy || recovery.busy;
  const termsRevision = config.legal.find((document) => document.type === 'terms')?.revision
    ?? 'unknown';

  const submit = async () => {
    if (mode === 'forgot') {
      await recovery.requestCode(email);
      return;
    }
    if (mode === 'verify') {
      await recovery.verifyCode(code);
      return;
    }
    if (mode === 'reset') {
      await recovery.resetPassword(password);
      return;
    }
    if (mode === 'phone') {
      if (!phoneCodeSent) {
        if (await requestPhoneCode(phone)) {
          setPhoneCodeSent(true);
          showToast('验证码已发送', 'success');
        }
        return;
      }
      await verifyPhoneCode(phone, code);
      return;
    }
    if ((mode === 'signIn' || mode === 'signUp') && !ensureConsent()) return;
    if (mode === 'signUp') {
      await signUp({ email, password, username, consentVersion: termsRevision });
    } else {
      await signIn({ email, password });
    }
  };

  const ensureConsent = () => {
    if (agreed) return true;
    showToast('请先阅读并同意用户协议与隐私政策', 'info');
    return false;
  };

  return (
    <View style={styles.page}>
      <PageHeader title={copy.title} />
      <ScrollView contentContainerStyle={authStyles.content}>
        <View style={authStyles.copy}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.secondary}>安全同步你的会员、订单与偏好设置。</Text>
        </View>
        {mode === 'signUp' ? (
          <TextInput
            accessibilityLabel="用户名"
            onChangeText={setUsername}
            placeholder="用户名"
            style={styles.input}
            value={username}
          />
        ) : null}
        {mode === 'phone' ? (
          <>
            <TextInput
              accessibilityLabel="手机号"
              keyboardType="phone-pad"
              onChangeText={setPhone}
              placeholder="+86 13800000000"
              style={styles.input}
              value={phone}
            />
            {phoneCodeSent ? (
              <TextInput
                accessibilityLabel="短信验证码"
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setCode}
                placeholder="6 位短信验证码"
                style={styles.input}
                value={code}
              />
            ) : null}
          </>
        ) : null}
        {mode === 'signIn' || mode === 'signUp' || mode === 'forgot' ? (
          <TextInput
            accessibilityLabel={mode === 'signIn' ? '账号' : '邮箱'}
            autoCapitalize="none"
            onChangeText={(value) => { setEmail(value); clearAuthError(); }}
            placeholder={mode === 'signIn' ? '用户名 / 邮箱 / 手机号' : '邮箱'}
            style={styles.input}
            value={email}
          />
        ) : null}
        {mode === 'verify' ? (
          <Text style={styles.secondary}>验证码已发送至 {recovery.email}</Text>
        ) : null}
        {mode !== 'forgot' && mode !== 'verify' && mode !== 'phone' ? (
          <TextInput
            accessibilityLabel="密码"
            onChangeText={(value) => { setPassword(value); clearAuthError(); }}
            placeholder={mode === 'reset' ? '新密码' : '密码'}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        ) : null}
        {mode === 'verify' ? (
          <TextInput
            accessibilityLabel="验证码"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setCode}
            placeholder="6 位验证码"
            style={styles.input}
            value={code}
          />
        ) : null}
        {lastAuthError ? (
          <Text style={authStyles.errorText}>{lastAuthError}</Text>
        ) : null}
        <AppButton
          disabled={busy || !isValid({ mode, email, password, username, code, phone, phoneCodeSent })}
          label={busy ? '正在处理…' : mode === 'phone' && phoneCodeSent ? '验证并登录' : copy.action}
          onPress={() => void submit()}
        />
        {mode === 'signIn' ? (
          <>
            <SocialAuthButtons onBeforeAuthenticate={ensureConsent} />
            <AppButton
              label="忘记密码"
              variant="secondary"
              onPress={() => navigate('auth.forgotPassword')}
            />
            <AppButton
              label="创建账号"
              variant="secondary"
              onPress={() => navigate('auth.signUp')}
            />
          </>
        ) : null}
        {mode === 'signIn' || mode === 'signUp' ? (
          <View style={authStyles.consentRow}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              accessibilityLabel="同意用户协议与隐私政策"
              hitSlop={8}
              onPress={() => setAgreed((value) => !value)}
              style={authStyles.checkboxTarget}
            >
              <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                {agreed ? <View style={styles.checkboxMark} /> : null}
              </View>
            </Pressable>
            <Text
              style={[styles.caption, authStyles.consentText]}
              accessibilityRole="button"
              accessibilityLabel="同意用户协议与隐私政策"
              onPress={() => setAgreed((value) => !value)}
            >
              我已阅读并同意{' '}
              <Text
                accessibilityRole="link"
                onPress={() => navigate('settings.termsOfService')}
                style={authStyles.legalLinkInline}
              >用户协议</Text>
              {' '}与{' '}
              <Text
                accessibilityRole="link"
                onPress={() => navigate('settings.privacyPolicy')}
                style={authStyles.legalLinkInline}
              >隐私政策</Text>
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

type AuthInput = Readonly<{
  mode: AuthMode;
  email: string;
  password: string;
  username: string;
  code: string;
  phone: string;
  phoneCodeSent: boolean;
}>;

function isValid(input: AuthInput) {
  const { mode, email, password, username, code, phone, phoneCodeSent } = input;
  if (mode === 'phone') {
    return /^\+[1-9]\d{7,14}$/.test(phone) && (!phoneCodeSent || /^\d{6}$/.test(code));
  }
  if (mode === 'verify') return /^\d{6}$/.test(code);
  if (mode === 'reset') return password.length >= 8;
  if (mode === 'signIn') return email.trim().length >= 2 && password.length > 0;
  if (!email.includes('@')) return false;
  if (mode === 'forgot') return true;
  if (mode === 'signUp' && username.trim().length < 2) return false;
  return password.length >= 8;
}

const authStyles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.x6, gap: spacing.x4 },
  copy: { gap: spacing.x2, marginBottom: spacing.x3 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.x1,
  },
  checkboxTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  consentText: { flexShrink: 1 },
  legalLinkInline: { color: colors.brand },
  errorText: { color: colors.error, fontSize: 13 },
});
