/**
 * 认证屏（RNR 重塑版）：login / signup / phone / forgot / verify / reset 六态共用一套卡片表单。
 * 业务逻辑与旧实现保持一致，仅替换视觉层为 react-native-reusables + Uniwind。
 */
import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { useUniwind } from 'uniwind';
import { useApp } from '../state/AppStore';
import { useAuthRecovery } from '../auth/AuthRecoveryStore';
import { SocialAuthButtons } from '../auth/SocialAuthButtons';

const LOGO = require('../../assets/brand/logo.png'); // eslint-disable-line @typescript-eslint/no-require-imports
const LOGO_DARK = require('../../assets/brand/logo-dark.png'); // eslint-disable-line @typescript-eslint/no-require-imports

export type AuthMode = 'signIn' | 'signUp' | 'phone' | 'forgot' | 'verify' | 'reset';

const authCopy: Record<AuthMode, Readonly<{ title: string; subtitle: string; action: string }>> = {
  signIn: { title: '掌鲸 DSH Pocket', subtitle: '登录后继续电脑上的工作，同一账号下的电脑会自动出现', action: '登录' },
  signUp: { title: '创建账号', subtitle: '几秒钟即可开始', action: '注册' },
  phone: { title: '手机号登录', subtitle: '使用短信验证码快速登录', action: '发送验证码' },
  forgot: { title: '找回密码', subtitle: '我们会向你的邮箱发送验证码', action: '发送验证码' },
  verify: { title: '验证邮箱', subtitle: '输入收到的 6 位验证码', action: '确认验证码' },
  reset: { title: '设置新密码', subtitle: '新密码至少 8 位', action: '确认修改' },
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
  const { theme } = useUniwind();
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

  /**
   * 分字段校验：返回第一条可操作的提示文案（null = 通过）。
   * 按钮不再因空表单而禁用，改为点按时明确告诉用户缺什么。
   */
  const validate = (): string | null => {
    if (mode === 'phone') {
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        return '请输入带国家码的手机号，例如 +8613800138000';
      }
      if (phoneCodeSent && !/^\d{6}$/.test(code)) return '请输入 6 位短信验证码';
      return null;
    }
    if (mode === 'verify') return /^\d{6}$/.test(code) ? null : '请输入 6 位验证码';
    if (mode === 'forgot') return email.includes('@') ? null : '请输入有效的邮箱';
    if (mode === 'reset') return password.length >= 8 ? null : '新密码至少 8 位';
    if (mode === 'signUp' && username.trim().length < 2) return '请输入用户名（至少 2 个字符）';
    if (mode === 'signIn') {
      if (email.trim().length < 2) return '请输入用户名 / 邮箱 / 手机号';
    } else if (!email.includes('@')) {
      return '请输入有效的邮箱';
    }
    if (password.length === 0) return '请输入密码';
    if (mode === 'signUp' && password.length < 8) return '密码至少 8 位';
    if (!ensureConsent()) return '__consent__';
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem !== null) {
      // 协议未勾选时 ensureConsent 已自行提示
      if (problem !== '__consent__') showToast(problem, 'info');
      return;
    }
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

  const showPassword = mode !== 'forgot' && mode !== 'verify' && mode !== 'phone';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="bg-background flex-1"
    >
      <ScrollView
        contentContainerClassName="flex-grow gap-6 px-6 pb-8 pt-10"
        keyboardShouldPersistTaps="handled"
      >
        <View className={mode === 'signIn' ? 'items-center gap-3 pt-4' : 'items-center gap-3'}>
          <Image
            source={theme === 'dark' ? LOGO_DARK : LOGO}
            className={mode === 'signIn' ? 'h-16 w-16' : 'h-14 w-14'}
            resizeMode="contain"
          />
          <Text
            className={
              mode === 'signIn'
                ? 'text-[28px] font-extrabold tracking-tight'
                : 'text-2xl font-bold'
            }
          >
            {copy.title}
          </Text>
          <Text className="text-muted-foreground max-w-[300px] text-center text-sm leading-5">
            {copy.subtitle}
          </Text>
        </View>

        <Card className="border-border/0 shadow-none">
          <CardContent className="gap-5 pt-6">
            {/* 登录首屏：第三方整行按钮优先（Apple / Google），自有账号表单在后 */}
            {mode === 'signIn' ? (
              <View className="gap-4">
                <SocialAuthButtons layout="stack" onBeforeAuthenticate={ensureConsent} />
                <View className="flex-row items-center">
                  <Separator className="flex-1" />
                  <Text className="text-muted-foreground px-3 text-xs">或使用账号密码</Text>
                  <Separator className="flex-1" />
                </View>
              </View>
            ) : null}

            {mode === 'signUp' ? (
              <View className="gap-1.5">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  accessibilityLabel="用户名"
                  autoCapitalize="none"
                  onChangeText={setUsername}
                  placeholder="你的昵称"
                  value={username}
                />
              </View>
            ) : null}

            {mode === 'phone' ? (
              <>
                <View className="gap-1.5">
                  <Label htmlFor="phone">手机号</Label>
                  <Input
                    id="phone"
                    accessibilityLabel="手机号"
                    keyboardType="phone-pad"
                    onChangeText={setPhone}
                    placeholder="+86 13800000000"
                    value={phone}
                  />
                </View>
                {phoneCodeSent ? (
                  <View className="gap-1.5">
                    <Label htmlFor="phone-code">短信验证码</Label>
                    <Input
                      id="phone-code"
                      accessibilityLabel="短信验证码"
                      keyboardType="number-pad"
                      maxLength={6}
                      onChangeText={setCode}
                      placeholder="6 位短信验证码"
                      value={code}
                    />
                  </View>
                ) : null}
              </>
            ) : null}

            {mode === 'signIn' || mode === 'signUp' || mode === 'forgot' ? (
              <View className="gap-1.5">
                <Label htmlFor="identifier">{mode === 'signIn' ? '账号' : '邮箱'}</Label>
                <Input
                  id="identifier"
                  accessibilityLabel={mode === 'signIn' ? '账号' : '邮箱'}
                  autoCapitalize="none"
                  keyboardType={mode === 'signIn' ? 'default' : 'email-address'}
                  onChangeText={(value) => { setEmail(value); clearAuthError(); }}
                  placeholder={mode === 'signIn' ? '用户名 / 邮箱 / 手机号' : 'you@example.com'}
                  testID="auth.identifier"
                  value={email}
                />
              </View>
            ) : null}

            {mode === 'verify' ? (
              <>
                <Text className="text-muted-foreground text-sm">
                  验证码已发送至 {recovery.email}
                </Text>
                <View className="gap-1.5">
                  <Label htmlFor="code">验证码</Label>
                  <Input
                    id="code"
                    accessibilityLabel="验证码"
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={setCode}
                    placeholder="6 位验证码"
                    value={code}
                  />
                </View>
              </>
            ) : null}

            {showPassword ? (
              <View className="gap-1.5">
                {mode === 'signIn' ? (
                  <View className="flex-row items-center">
                    <Label htmlFor="password">密码</Label>
                    <Button
                      className="ml-auto h-5 px-1"
                      onPress={() => navigate('auth.forgotPassword')}
                      size="sm"
                      variant="link"
                    >
                      <Text className="text-sm font-normal">忘记密码？</Text>
                    </Button>
                  </View>
                ) : (
                  <Label htmlFor="password">密码</Label>
                )}
                <Input
                  id="password"
                  accessibilityLabel="密码"
                  autoCapitalize="none"
                  onChangeText={(value) => { setPassword(value); clearAuthError(); }}
                  placeholder={mode === 'reset' ? '新密码（至少 8 位）' : '密码'}
                  secureTextEntry
                  testID="auth.password"
                  value={password}
                />
              </View>
            ) : null}

            {lastAuthError ? (
              <Text className="text-destructive text-sm">{lastAuthError}</Text>
            ) : null}

            {mode === 'signIn' || mode === 'signUp' ? (
              <View className="flex-row items-start justify-center gap-2">
                <Checkbox
                  accessibilityLabel="同意用户协议与隐私政策"
                  checked={agreed}
                  className="border-muted-foreground/60 mt-0.5"
                  onCheckedChange={(checked) => setAgreed(checked === true)}
                />
                <Text className="text-muted-foreground flex-shrink text-xs leading-5">
                  我已阅读并同意{' '}
                  <Text
                    accessibilityRole="link"
                    className="text-foreground underline underline-offset-4"
                    onPress={() => navigate('settings.termsOfService')}
                  >用户协议</Text>
                  {' '}与{' '}
                  <Text
                    accessibilityRole="link"
                    className="text-foreground underline underline-offset-4"
                    onPress={() => navigate('settings.privacyPolicy')}
                  >隐私政策</Text>
                </Text>
              </View>
            ) : null}

            <Button
              className="w-full"
              disabled={busy}
              onPress={() => void submit()}
              testID="auth.submit"
            >
              <Text>{busy ? '正在处理…' : mode === 'phone' && phoneCodeSent ? '验证并登录' : copy.action}</Text>
            </Button>

            {mode === 'signIn' ? (
              <Pressable className="items-center" onPress={() => navigate('auth.signUp')}>
                <Text className="text-muted-foreground text-sm">
                  还没有账号？
                  <Text className="text-foreground underline underline-offset-4">创建账号</Text>
                </Text>
              </Pressable>
            ) : null}

            {mode !== 'signIn' ? (
              <Pressable className="items-center" onPress={() => navigate('auth.signIn')}>
                <Text className="text-muted-foreground text-sm">
                  返回<Text className="text-foreground underline underline-offset-4">登录</Text>
                </Text>
              </Pressable>
            ) : null}
          </CardContent>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
