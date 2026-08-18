import {
  AppUser,
  AuthSession,
  BootstrapPayload,
  CouponView,
  HelpArticle,
  NotificationItem,
  OrderView,
  ProductFeedback,
  ReferralView,
  SessionView,
  SupportConfig,
  SupportMessage,
  SupportTicket,
  SupportTicketDetail,
  UserSettings,
  UsageSummary,
} from '../domain/models';
import { parseOrderStatus, type CreateOrderResult, type MembershipCurrent } from '../payment/paymentModels';
import { getPlatformHeader } from './runtimePlatform';

type Envelope<T> = Readonly<{ data: T }>;
type ErrorPayload = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  traceId: string;
  retryAfterSeconds?: number;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;
type ErrorEnvelope = Readonly<{ error: ErrorPayload }>;

function getApiBase() {
  return process.env.EXPO_PUBLIC_API_URL
    ?? (getPlatformHeader() === 'android' ? 'http://10.0.2.2:3210' : 'http://localhost:3210');
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
    readonly fieldErrors?: Readonly<Record<string, readonly string[]>>,
  ) {
    super(message);
  }
}

// S3 storage upload (BaaS): presigned PUT 直传 OSS。url 为对象访问 URL，
// avatar 等场景存它（base64 退役）。
interface SignUploadResult {
  uploadUrl: string;
  url: string;
  objectKey: string;
}

async function uploadAvatarToStorage(jpegBase64: string, userId: string): Promise<string> {
  const sign = await request<SignUploadResult>('/api/v1/storage/uploads', jsonOptions(
    'POST',
    { path: `avatars/${userId}-${Date.now()}.jpg`, contentType: 'image/jpeg' },
  ));
  const binary = Uint8Array.from(atob(jpegBase64), c => c.charCodeAt(0));
  const put = await fetch(sign.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: binary,
  });
  if (!put.ok) throw new Error(`对象存储上传失败 ${put.status}`);
  return sign.url;
}

// objectKey → presigned GET URL（私有 bucket，24h）。通用资产显示前换取。
async function resolveObjectUrl(objectKey: string): Promise<string | null> {
  try {
    const result = await request<{ url: string }>(
      `/api/v1/storage/urls?key=${encodeURIComponent(objectKey)}`,
    );
    return result.url ?? null;
  } catch {
    return null;
  }
}

// 会话级缓存 + 并发合并（同一 objectKey 只请求一次；失败/过期 invalidate）。
const assetUrlCache = new Map<string, string>();

export async function resolveAssetUrl(objectKey: string): Promise<string | null> {
  if (objectKey.startsWith('http://') || objectKey.startsWith('https://') ||
      objectKey.startsWith('data:')) {
    return objectKey;
  }
  const cached = assetUrlCache.get(objectKey);
  if (cached) return cached;
  const url = await resolveObjectUrl(objectKey);
  if (url) assetUrlCache.set(objectKey, url);
  return url;
}

export function invalidateAssetUrl(objectKey: string): void {
  assetUrlCache.delete(objectKey);
}

export const apiClient = {
  uploadAvatarToStorage,
  resolveObjectUrl,
  bootstrap: () => request<BootstrapPayload>('/api/v1/bootstrap'),
  signIn: (identifier: string, password: string) => requestAuth('/api/v1/auth/sign-in', {
    identifier,
    password,
    deviceName: `${getPlatformHeader()} · 掌鲸 DSH Pocket`,
  }),
  signUp: (email: string, password: string, username: string, consentVersion: string) =>
    requestAuth('/api/v1/auth/sign-up', {
      email,
      password,
      username,
      consentVersion,
      deviceName: `${getPlatformHeader()} · 掌鲸 DSH Pocket`,
    }),
  verifyEmail: (email: string, code: string) => request<{ verified: boolean }>(
    '/api/v1/auth/verify-email', jsonOptions('POST', { email, code }),
  ),
  resendEmailVerification: (email: string) => request<{
    accepted: boolean;
    resendAfterSeconds: number;
  }>('/api/v1/auth/verify-email/resend', jsonOptions('POST', { email })),
  socialSignIn: (input: {
    provider: 'apple' | 'google' | 'github';
    idToken?: string;
    authorizationCode?: string;
    redirectUri?: string;
    codeVerifier?: string;
    nonce?: string;
  }) => requestAuth('/api/v1/auth/social', {
    ...input,
    deviceName: `${getPlatformHeader()} · 掌鲸 DSH Pocket`,
  }),
  signOut: () => request<{ signedOut: boolean }>('/api/v1/auth/sign-out', { method: 'POST' }),
  signOutAll: () => request<{ signedOut: boolean }>('/api/v1/auth/sign-out-all', { method: 'POST' }),
  requestPhoneCode: (phone: string) => request<{
    accepted: boolean;
    resendAfterSeconds: number;
  }>('/api/v1/auth/phone/request', jsonOptions('POST', { phone })),
  verifyPhoneCode: (phone: string, code: string) => requestAuth('/api/v1/auth/phone/verify', {
    phone,
    code,
    deviceName: `${getPlatformHeader()} · 掌鲸 DSH Pocket`,
  }),
  requestPasswordReset: (email: string) => request<{
    accepted: boolean;
    resendAfterSeconds: number;
  }>('/api/v1/auth/password/forgot', jsonOptions('POST', { email })),
  verifyPasswordReset: (email: string, code: string) => request<{
    resetToken: string;
    expiresInSeconds: number;
  }>('/api/v1/auth/password/verify', jsonOptions('POST', { email, code })),
  resetPassword: (resetToken: string, newPassword: string) => request<{
    changed: boolean;
    requiresSignIn: boolean;
  }>('/api/v1/auth/password/reset', jsonOptions('POST', { resetToken, newPassword })),
  updateProfile: (patch: { displayName?: string; bio?: string; avatarUrl?: string | null }) =>
    request<AppUser>('/api/v1/me/profile', jsonOptions('PATCH', patch)),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: boolean; requiresSignIn: boolean }>(
      '/api/v1/me/change-password',
      jsonOptions('POST', { currentPassword, newPassword }),
    ),
  saveSettings: (patch: UserSettings) =>
    request<UserSettings>('/api/v1/me/settings', jsonOptions('PUT', patch)),
  sessions: () => request<readonly SessionView[]>('/api/v1/me/sessions'),
  revokeSession: (id: string) =>
    request<{ revoked: boolean }>(`/api/v1/me/sessions/${id}`, { method: 'DELETE' }),
  notifications: () => request<readonly NotificationItem[]>('/api/v1/notifications'),
  readAllNotifications: () =>
    request<{ allRead: boolean }>('/api/v1/notifications', { method: 'PATCH' }),
  readNotification: (id: string) =>
    request<{ read: boolean }>(`/api/v1/notifications/${id}`, { method: 'PATCH' }),
  deleteNotification: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/notifications/${id}`, { method: 'DELETE' }),
  orders: () => request<readonly OrderView[]>('/api/v1/orders')
    .then((rows) => rows.map(toOrderView)),
  usage: () => request<UsageSummary>('/api/v1/me/usage'),
  coupons: () => request<readonly CouponView[]>('/api/v1/me/coupons'),
  referral: () => request<ReferralView>('/api/v1/me/referral'),
  createOrder: (planId: string, idempotencyKey: string) => request<CreateOrderResult>(
    '/api/v1/orders',
    {
      ...jsonOptions('POST', { planId }),
      headers: {
        ...clientHeaders(),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    },
  ),
  verifyPurchase: (orderId: string | undefined, receipt: unknown) => request<OrderView>(
    '/api/v1/purchases/verify',
    jsonOptions('POST', { ...(orderId ? { orderId } : {}), receipt }),
  ).then(toOrderView),
  restore: (receipts: unknown[]) => request<{ entitlements: readonly string[] }>(
    '/api/v1/purchases/restore',
    jsonOptions('POST', { receipts }),
  ),
  membershipCurrent: () => request<MembershipCurrent>('/api/v1/membership/current'),
  entitlements: () => request<{ keys: readonly string[] }>('/api/v1/membership/entitlements'),
  deleteAccount: (password: string) => request<{ deleted: boolean }>(
    '/api/v1/me/deletion',
    jsonOptions('DELETE', { password, confirmation: 'DELETE' }),
  ),
  telemetry: (batch: {
    anonymousId: string;
    sessionId: string;
    events: readonly Record<string, unknown>[];
  }, signal?: AbortSignal) => request<{ accepted: number; duplicates: number }>(
    '/api/v1/telemetry/events',
    { ...jsonOptions('POST', batch), signal },
  ),
  supportConfig: () => request<Pick<
    SupportConfig,
    'enabled' | 'market' | 'dataRegion' | 'categories'
  >>('/api/v1/support/config'),
  helpArticles: () => request<readonly HelpArticle[]>('/api/v1/support/help'),
  supportTickets: () => request<readonly SupportTicket[]>('/api/v1/support/tickets'),
  supportTicket: (id: string) =>
    request<SupportTicketDetail>(`/api/v1/support/tickets/${id}`),
  createSupportTicket: (input: {
    category: string;
    severity: 'normal' | 'high' | 'urgent';
    subject: string;
    message: string;
  }) => request<SupportTicket>('/api/v1/support/tickets', jsonOptions('POST', input)),
  replySupportTicket: (id: string, message: string) =>
    request<SupportMessage>(
      `/api/v1/support/tickets/${id}/messages`,
      jsonOptions('POST', { message }),
    ),
  submitFeedback: (input: {
    category: 'suggestion' | 'experience' | 'feature_request' | 'other';
    title: string;
    body: string;
    rating?: number;
    screenshots: readonly Readonly<{
      fileName: string;
      mimeType: 'image/jpeg';
      data: string;
    }>[];
  }) => request<ProductFeedback>('/api/v1/support/feedback', jsonOptions('POST', input)),
};

// Token/anonymous sources are injectable so the HTTP layer is node-testable
// (RN storage imports react-native/expo modules that don't load in node).
// Defaults lazily load the RN implementation only when actually used.
type Reader = () => Promise<string | null>;
let sessionTokenReader: Reader = () => import('./storage').then((m) => m.readSessionToken());
let refreshTokenReader: Reader = () => import('./storage').then((m) => m.readRefreshToken());
let anonymousIdReader: Reader = () => import('./storage').then((m) => m.readAnonymousId());
let sessionTokenWriter: (token: string | null) => Promise<void> =
  (token) => import('./storage').then((m) => m.saveSessionToken(token));
let refreshTokenWriter: (token: string | null) => Promise<void> =
  (token) => import('./storage').then((m) => m.saveRefreshToken(token));

export function setSessionTokenReader(reader: Reader) { sessionTokenReader = reader; }
export function setRefreshTokenReader(reader: Reader) { refreshTokenReader = reader; }
export function setAnonymousIdReader(reader: Reader) { anonymousIdReader = reader; }
export function setSessionTokenWriter(writer: (token: string | null) => Promise<void>) { sessionTokenWriter = writer; }
export function setRefreshTokenWriter(writer: (token: string | null) => Promise<void>) { refreshTokenWriter = writer; }

// Platform header injection is re-exported so callers configure the whole HTTP
// layer through apiClient alone (tests set it to 'ios'; App sets Platform.OS).
export { setPlatformHeader } from './runtimePlatform';

async function requestAuth(
  path: string,
  body: Readonly<Record<string, string | undefined>>,
) {
  return request<AuthSession>(path, jsonOptions('POST', body));
}

let refreshInFlight: Promise<boolean> | null = null;
let sessionExpiredHandler: (() => void) | null = null;

// AppStore registers this so that an unrecoverable session expiry clears the
// user and bounces to the sign-in guard, instead of looping on failing calls.
export function registerSessionExpiredHandler(handler: (() => void) | null) {
  sessionExpiredHandler = handler;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return sendRequest<T>(path, options, false);
}

async function sendRequest<T>(
  path: string,
  options: RequestInit,
  retried: boolean,
): Promise<T> {
  const [token, installationId] = await Promise.all([
    sessionTokenReader(),
    anonymousIdReader(),
  ]);
  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers: {
        ...clientHeaders(),
        ...(installationId ? { 'X-Installation-Id': installationId } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw serviceUnavailableError();
  }
  if (response.status === 401 && !retried && await refreshSession()) {
    return sendRequest<T>(path, options, true);
  }
  const body = await parseResponse<T>(response);
  if (!response.ok || 'error' in body) {
    const error: ErrorPayload = 'error' in body ? body.error : {
      code: 'HTTP_ERROR',
      message: response.status >= 500 ? '服务暂时不可用，请稍后重试' : '服务请求失败',
      retryable: response.status >= 500,
      traceId: 'local',
    };
    if (response.status === 401 && !retried) sessionExpiredHandler?.();
    throw new ApiClientError(
      error.code,
      specificErrorMessage(error.message, error.fieldErrors),
      response.status,
      error.retryable,
      error.retryAfterSeconds,
      error.fieldErrors,
    );
  }
  return body.data;
}

export function specificErrorMessage(
  fallback: string,
  fieldErrors?: Readonly<Record<string, readonly string[]>>,
) {
  if (!fieldErrors) return fallback;
  const messages = [...new Set(Object.values(fieldErrors).flat().filter(Boolean))];
  return messages.length ? messages.join('；') : fallback;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) refreshInFlight = performRefresh();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function performRefresh(): Promise<boolean> {
  const refreshToken = await refreshTokenReader();
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${getApiBase()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { ...clientHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const body = await response.json() as Envelope<AuthSession>;
    const data = body?.data;
    if (!data?.token || !data?.refreshToken) return false;
    await sessionTokenWriter(data.token);
    await refreshTokenWriter(data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function parseResponse<T>(response: Response): Promise<Envelope<T> | ErrorEnvelope> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Envelope<T> | ErrorEnvelope;
  } catch {
    if (response.status >= 500) throw serviceUnavailableError(response.status);
    throw new ApiClientError('INVALID_RESPONSE', '服务返回了无法识别的数据', response.status, false);
  }
}

function serviceUnavailableError(status = 0) {
  return new ApiClientError(
    'SERVICE_UNAVAILABLE',
    '无法连接服务器，请检查网络后重试',
    status,
    true,
  );
}

// Normalize OrderView.status at the boundary: the wire returns raw strings,
// but OrderView.status is the typed OrderStatus union.
function toOrderView(raw: OrderView): OrderView {
  return { ...raw, status: parseOrderStatus(raw.status) };
}

function jsonOptions(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// 每个 App 必须通过 EXPO_PUBLIC_APP_ID 声明自己的 app_id（租户）。
// 未配置时启动即抛错，避免混入不可预测的 app_id。
const APP_ID = process.env.EXPO_PUBLIC_APP_ID?.trim();
if (!APP_ID) {
  throw new Error('EXPO_PUBLIC_APP_ID 未配置：请在 .env 中设置该 App 的 app_id 后再启动。');
}

// environment（development/staging/production 等）也必须显式配置，未配置即启动报错。
const APP_ENVIRONMENT = process.env.EXPO_PUBLIC_APP_ENVIRONMENT?.trim();
if (!APP_ENVIRONMENT) {
  throw new Error('EXPO_PUBLIC_APP_ENVIRONMENT 未配置：请在 .env 中设置该 App 的 environment 后再启动。');
}

function clientHeaders() {
  return {
    'X-App-Id': APP_ID,
    'X-App-Environment': APP_ENVIRONMENT,
    'X-Platform': getPlatformHeader(),
    'X-App-Version': '1.0.0',
    'Accept-Language': 'zh-CN',
  };
}
