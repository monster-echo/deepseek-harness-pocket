import { OrderStatus, StoreProductMapping } from '../payment/paymentModels';

export type UserSettings = Readonly<Record<string, string | boolean | number>>;

export type AppUser = Readonly<{
  id: string;
  // 可空：手机号/华为登录未绑定邮箱；hasEmail=false 时 UI 不展示 email。
  email: string | null;
  hasEmail: boolean;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  tierId: string;
  settings: UserSettings;
  emailVerified: boolean;
  consentVersion: string | null;
  createdAt: string;
}>;

export type AuthSession = Readonly<{
  token: string;
  refreshToken: string;
  user: AppUser;
}>;

export type PasswordPolicy = Readonly<{
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
}>;

export type MembershipTier = Readonly<{
  id: string;
  name: string;
  summary: string;
  recommended: boolean;
  accent: string;
  entitlements: readonly string[];
}>;

export type BillingPlan = Readonly<{
  id: string;
  tierId: string;
  name: string;
  interval: 'month' | 'year' | 'lifetime' | 'one_time';
  priceMinor: number;
  originalPriceMinor?: number;
  currency: string;
  provider: 'mock' | 'apple' | 'google' | 'wechat' | 'alipay';
  storeProductMapping?: StoreProductMapping;
}>;

export type RuntimeConfig = Readonly<{
  schemaVersion: number;
  version: number;
  cacheTtlSeconds: number;
  telemetry: Readonly<{
    enabled: boolean;
    backendEnabled: boolean;
    firebaseMode: 'disabled' | 'client_direct' | 'server_forwarded';
    analyticsEnabled: boolean;
    crashlyticsEnabled: boolean;
  }>;
  support: SupportConfig;
  brand: Readonly<{
    appName: string;
    tagline: string;
    primaryColor: string;
  }>;
  splash: Readonly<{
    id: string;
    title: string;
    description: string;
    badge: string;
    actionLabel: string;
    imageUrl: string | null;
    videoUrl: string | null;
    linkUrl: string | null;
    skippable: boolean;
    durationSeconds: number;
  }> | null;
  auth: Readonly<{
    providers: ReadonlyArray<Readonly<{
      id: 'password' | 'phone' | 'apple' | 'google' | 'github' | 'wechat';
      enabled: boolean;
      platforms: readonly string[];
      clientIds?: Readonly<Record<string, string | undefined>>;
    }>>;
    passwordPolicy: PasswordPolicy;
  }>;
  legal: ReadonlyArray<Readonly<{
    type: 'privacy' | 'terms' | 'subscription';
    locale: 'zh-CN' | 'en-US';
    revision: string;
    title: string;
    content: string;
    requiresReconsent: boolean;
  }>>;
  settingsPolicy: Readonly<Record<string, Readonly<{
    visibility: 'visible' | 'hidden';
    mutability: 'user' | 'admin_locked' | 'system';
  }>>>;
  features: Readonly<Record<string, boolean>>;
  entitlements: ReadonlyArray<Readonly<{
    key: string;
    label: string;
    description: string;
  }>>;
  tiers: readonly MembershipTier[];
  plans: readonly BillingPlan[];
}>;

export type SupportConfig = Readonly<{
  enabled: boolean;
  market: string;
  dataRegion: string;
  categories: ReadonlyArray<Readonly<{ id: string; label: string }>>;
  queues: ReadonlyArray<Readonly<{
    id: string;
    market: string;
    locales: readonly string[];
    categories: readonly string[];
  }>>;
  help: readonly HelpArticle[];
}>;

export type HelpArticle = Readonly<{
  id: string;
  locale: string;
  title: string;
  body: string;
}>;

export type SupportTicket = Readonly<{
  id: string;
  category: string;
  severity: 'normal' | 'high' | 'urgent';
  subject: string;
  status: string;
  locale: string;
  market: string;
  dataRegion: string;
  queueId: string;
  createdAt: string;
  updatedAt: string;
}>;

export type SupportMessage = Readonly<{
  id: string;
  authorType: 'user' | 'support' | 'system';
  body: string;
  createdAt: string;
}>;

export type SupportTicketDetail = SupportTicket & Readonly<{
  messages: readonly SupportMessage[];
}>;

export type ProductFeedback = Readonly<{
  id: string;
  category: string;
  title: string;
  body: string;
  rating: number | null;
  status: string;
  market: string;
  dataRegion: string;
  queueId: string;
  createdAt: string;
  updatedAt: string;
}>;

export type AuthProviders = Readonly<{
  password: boolean;
  phone: boolean;
  apple: boolean;
  google: boolean;
  github: boolean;
  wechat: boolean;
}>;

export type AuthProviderPolicy = Readonly<Record<
  'password' | 'phone' | 'apple' | 'google' | 'github' | 'wechat',
  boolean
>>;

export type AuthProviderConfig = Readonly<Partial<Record<
  'apple' | 'google' | 'github',
  Readonly<{ clientId: string }>
>>>;

export type BootstrapPayload = Readonly<{
  config: RuntimeConfig;
  user: AppUser | null;
  authProviders: AuthProviders;
  authProviderPolicy: AuthProviderPolicy;
  authProviderConfig: AuthProviderConfig;
  serverTime: string;
  apiVersion: string;
}>;

export type SessionView = Readonly<{
  id: string;
  deviceName: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
}>;

export type NotificationItem = Readonly<{
  id: string;
  type: string;
  title: string;
  body: string;
  route: string | null;
  readAt: string | null;
  createdAt: string;
}>;

export type OrderView = Readonly<{
  id: string;
  planId: string;
  status: OrderStatus;
  amountMinor: number;
  currency: string;
  provider: string;
  createdAt: string;
  completedAt: string | null;
}>;

export type UsageSummary = Readonly<{
  sessions: number;
  screenViews: number;
  activeMinutes: number;
  screens: ReadonlyArray<Readonly<{
    screenId: string;
    views: number;
    durationMs: number;
  }>>;
}>;

export type CouponView = Readonly<{
  id: string;
  code: string;
  title: string;
  discountLabel: string;
  expiresAt: string | null;
  usedAt: string | null;
  createdAt: string;
}>;

export type ReferralView = Readonly<{
  code: string;
  invited: number;
  shareUrl: string;
}>;
