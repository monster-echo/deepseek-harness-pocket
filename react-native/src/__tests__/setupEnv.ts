// 单元测试不经过 Expo 构建期的 .env 注入；apiClient 在 import 时即校验
// EXPO_PUBLIC_APP_ID / EXPO_PUBLIC_APP_ENVIRONMENT，这里补测试安全的默认值。
// 真实环境变量优先（??= 不覆盖已存在值）。
process.env.EXPO_PUBLIC_APP_ID ??= 'dshcompanion';
process.env.EXPO_PUBLIC_APP_ENVIRONMENT ??= 'test';
