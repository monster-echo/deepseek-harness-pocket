import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { invalidateAssetUrl, resolveAssetUrl } from '../data/apiClient';
import * as ImagePicker from 'expo-image-picker';
import {
  AppButton,
  AppCard,
  ListRow,
  OfflineBanner,
  PageHeader,
} from '../design-system/components';
import { useApp } from '../state/AppStore';
import { AvatarCropEditor } from '../profile/AvatarCropEditor';
import { ProfileIdentityCard } from '../profile/ProfileIdentityCard';
import { usePreferences } from '../preferences/PreferencesProvider';
import { PrimaryTabs } from '../navigation/PrimaryTabs';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

export function ProfileScreen() {
  const { user, config, navigate, signOut, showConfirm } = useApp();
  if (!user) return <SignedOutProfile />;
  const tier = config.tiers.find((item) => item.id === user.tierId);
  const requestSignOut = () => showConfirm({
    title: '退出登录？',
    message: '服务端会撤销当前会话，本机敏感凭据也会清除。',
    confirmLabel: '退出',
    onConfirm: signOut,
  });
  return (
    <View style={styles.page}>
      <OfflineBanner />
      <PageHeader title="我的" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ProfileIdentityCard
          displayName={user.displayName}
          username={user.username}
          email={user.hasEmail && user.email ? user.email : '未绑定邮箱'}
          bio={user.bio}
          avatarUrl={user.avatarUrl}
        />
        <View style={profileStyles.membership}>
          <Text style={profileStyles.membershipTitle}>{tier?.name ?? user.tierId}</Text>
          <Text style={profileStyles.membershipText}>
            {tier?.summary ?? '会员信息由服务端动态配置'}
          </Text>
          <AppButton
            label="查看会员权益"
            icon="crown"
            onPress={() => navigate('membership.home')}
          />
        </View>
        <AppCard>
          <ListRow label="个人资料" route="profile.edit" icon="user" />
          {config.features.statistics ? (
            <ListRow label="使用统计" route="profile.statistics" icon="home" />
          ) : null}
          {config.features.coupons ? (
            <ListRow label="优惠券" route="profile.coupons" icon="gift" />
          ) : null}
          {config.features.invites ? (
            <ListRow label="邀请好友" route="profile.invite" icon="gift" />
          ) : null}
          <ListRow label="订单管理" route="membership.orders" icon="crown" />
          <ListRow label="设置" route="settings.home" icon="settings" />
        </AppCard>
        <AppButton label="退出登录" variant="danger" onPress={requestSignOut} />
      </ScrollView>
      <PrimaryTabs active="profile" />
    </View>
  );
}

function SignedOutProfile() {
  const { navigate } = useApp();
  return (
    <View style={styles.page}>
      <PageHeader title="我的" />
      <View style={styles.centered}>
        <Avatar label="M" />
        <Text style={styles.title}>登录后同步你的数据</Text>
        <Text style={styles.secondary}>会员、订单与设置会安全同步。</Text>
        <View style={profileStyles.fullWidth}>
          <AppButton label="登录或注册" onPress={() => navigate('auth.signIn')} />
        </View>
      </View>
      <PrimaryTabs active="profile" />
    </View>
  );
}

// 头像显示：兼容 objectKey（→ presigned 24h）/ http(s) / data: 三种形态。
function Avatar({ avatarUrl, label }: Readonly<{ avatarUrl?: string | null; label: string }>) {
  const { palette } = usePreferences();
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!avatarUrl) return;
    void resolveAssetUrl(avatarUrl).then(url => {
      if (alive) setResolved(url);
    });
    return () => { alive = false; };
  }, [avatarUrl]);
  if (resolved) {
    return (
      <Image
        accessibilityLabel="用户头像"
        source={{ uri: resolved }}
        style={profileStyles.avatar}
        onError={() => {
          if (avatarUrl) invalidateAssetUrl(avatarUrl);
          setResolved(null);
        }}
      />
    );
  }
  return (
    <View style={[profileStyles.avatar, { backgroundColor: palette.brandSoft }]}>
      <Text style={profileStyles.avatarText}>{label}</Text>
    </View>
  );
}

export function EditProfileScreen() {
  const { user, updateProfile, busy, showToast } = useApp();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [cropAsset, setCropAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const chooseAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('需要相册权限才能选择头像', 'error');
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    const asset = selection.assets?.[0];
    if (selection.canceled || !asset) return;
    setCropAsset(asset);
  };
  const save = async () => {
    if (await updateProfile({ displayName, bio, avatarUrl: avatarUrl || null })) {
      showToast('个人资料已保存到服务端', 'success');
    }
  };
  return (
    <View style={styles.page}>
      <PageHeader title="个人资料" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ProfileIdentityCard
          displayName={displayName || user?.username || 'M'}
          username={user?.username ?? ''}
          email={user?.hasEmail && user?.email ? user.email : '未绑定邮箱'}
          bio={bio}
          avatarUrl={avatarUrl}
          onAvatarPress={() => void chooseAvatar()}
        />
        <Text style={styles.sectionLabel}>用户名（不可修改）</Text>
        <Text style={styles.secondary}>@{user?.username}</Text>
        <Text style={styles.sectionLabel}>显示名称</Text>
        <TextInput
          accessibilityLabel="显示名称"
          maxLength={40}
          onChangeText={setDisplayName}
          style={styles.input}
          value={displayName}
        />
        <Text style={styles.sectionLabel}>个人简介</Text>
        <TextInput
          accessibilityLabel="个人简介"
          maxLength={160}
          multiline
          onChangeText={setBio}
          placeholder="介绍一下自己"
          style={[styles.input, profileStyles.bioInput]}
          value={bio}
        />
        <Text style={styles.caption}>点击上方头像选择图片，可拖动和缩放裁剪为 512×512。</Text>
        <AppButton
          disabled={busy}
          label={busy ? '保存中…' : '保存资料'}
          icon="check"
          onPress={() => void save()}
        />
      </ScrollView>
      {cropAsset ? (
        <AvatarCropEditor
          asset={cropAsset}
          onCancel={() => setCropAsset(null)}
          onConfirm={(value) => {
            setAvatarUrl(value);
            setCropAsset(null);
          }}
        />
      ) : null}
    </View>
  );
}

const profileStyles = StyleSheet.create({
  fullWidth: { width: '100%' },
  bioInput: { minHeight: 96, textAlignVertical: 'top' },
  avatar: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.round,
    backgroundColor: colors.brandSoft,
  },
  avatarText: { color: colors.brand, fontSize: 20, fontWeight: '700' },
  membership: {
    borderRadius: radii.card,
    padding: spacing.x5,
    gap: spacing.x3,
    backgroundColor: colors.text,
  },
  membershipTitle: { color: colors.surface, fontSize: 22, fontWeight: '700' },
  membershipText: { color: colors.border, fontSize: 14 },
});
