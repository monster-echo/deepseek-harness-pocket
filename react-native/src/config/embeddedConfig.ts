import { RuntimeConfig } from '../domain/models';

export const embeddedConfig: RuntimeConfig = {
  schemaVersion: 1,
  version: 0,
  cacheTtlSeconds: 900,
  telemetry: {
    enabled: true,
    backendEnabled: true,
    firebaseMode: 'disabled',
    analyticsEnabled: false,
    crashlyticsEnabled: false,
  },
  support: {
    enabled: true,
    market: 'global',
    dataRegion: 'us',
    categories: [
      { id: 'account', label: '账号与登录' },
      { id: 'billing', label: '会员与支付' },
      { id: 'technical', label: '功能故障' },
      { id: 'privacy', label: '隐私与数据' },
      { id: 'suggestion', label: '产品建议' },
    ],
    queues: [{
      id: 'global',
      market: 'global',
      locales: ['zh-CN', 'en-US'],
      categories: ['account', 'billing', 'technical', 'privacy', 'suggestion'],
    }],
    help: [{
      id: 'offline-help',
      locale: 'zh-CN',
      title: '当前处于离线模式',
      body: '联网后可读取此 App 的最新帮助内容并提交工单。',
    }],
  },
  brand: {
    appName: '掌鲸 DSH Pocket',
    tagline: '把 DeepSeek Harness 装进口袋',
    primaryColor: '#B03C3C',
  },
  splash: null,
  auth: {
    providers: [
      { id: 'password', enabled: true, platforms: ['ios', 'android', 'harmonyos', 'web'] },
      { id: 'phone', enabled: true, platforms: ['ios', 'android', 'harmonyos', 'web'] },
    ],
    passwordPolicy: {
      minLength: 8,
      maxLength: 72,
      requireUppercase: false,
      requireLowercase: true,
      requireDigit: true,
      requireSymbol: false,
    },
  },
  legal: [
    {
      type: 'privacy',
      locale: 'zh-CN',
      revision: 'embedded-1',
      title: '隐私政策',
      content: '离线状态下显示随 App 发布的隐私政策快照。',
      requiresReconsent: false,
    },
  ],
  settingsPolicy: {
    language: { visibility: 'visible', mutability: 'user' },
    appearance: { visibility: 'visible', mutability: 'user' },
    notifications: { visibility: 'visible', mutability: 'user' },
    analytics: { visibility: 'visible', mutability: 'user' },
    general: { visibility: 'visible', mutability: 'user' },
    accountDeletion: { visibility: 'visible', mutability: 'user' },
  },
  features: {
    membership: true,
    notifications: true,
    profileEditing: true,
    accountDeletion: true,
  },
  entitlements: [],
  tiers: [
    {
      id: 'free',
      name: 'Free',
      summary: '基础功能',
      recommended: false,
      accent: '#667085',
      entitlements: [],
    },
  ],
  plans: [],
};
