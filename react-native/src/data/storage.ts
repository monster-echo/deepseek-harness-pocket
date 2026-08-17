import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { RuntimeConfig } from '../domain/models';

const tokenKey = 'mobileui.session';
const refreshTokenKey = 'mobileui.session.refresh';
const configKey = 'mobileui.config.lastKnownGood';
const anonymousKey = 'mobileui.telemetry.anonymousId';
const telemetryQueueKey = 'mobileui.telemetry.queue';
let anonymousIdPromise: Promise<string> | null = null;

export async function readSessionToken() {
  if (Platform.OS === 'web') return window.localStorage.getItem(tokenKey);
  return SecureStore.getItemAsync(tokenKey);
}

export async function saveSessionToken(token: string | null) {
  if (Platform.OS === 'web') {
    if (token) window.localStorage.setItem(tokenKey, token);
    else window.localStorage.removeItem(tokenKey);
    return;
  }
  if (token) await SecureStore.setItemAsync(tokenKey, token);
  else await SecureStore.deleteItemAsync(tokenKey);
}

export async function readRefreshToken() {
  if (Platform.OS === 'web') return window.localStorage.getItem(refreshTokenKey);
  return SecureStore.getItemAsync(refreshTokenKey);
}

export async function saveRefreshToken(token: string | null) {
  if (Platform.OS === 'web') {
    if (token) window.localStorage.setItem(refreshTokenKey, token);
    else window.localStorage.removeItem(refreshTokenKey);
    return;
  }
  if (token) await SecureStore.setItemAsync(refreshTokenKey, token);
  else await SecureStore.deleteItemAsync(refreshTokenKey);
}

export async function clearAuthStorage() {
  await saveSessionToken(null);
  await saveRefreshToken(null);
}

export async function readCachedConfig(): Promise<RuntimeConfig | null> {
  const value = await AsyncStorage.getItem(configKey);
  if (!value) return null;
  try {
    const config = JSON.parse(value) as RuntimeConfig;
    return config.schemaVersion === 1 ? config : null;
  } catch {
    return null;
  }
}

export async function saveCachedConfig(config: RuntimeConfig) {
  await AsyncStorage.setItem(configKey, JSON.stringify(config));
}

async function loadAnonymousId() {
  const existing = await AsyncStorage.getItem(anonymousKey);
  if (existing) return existing;
  const created = `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await AsyncStorage.setItem(anonymousKey, created);
  return created;
}

export function readAnonymousId() {
  anonymousIdPromise ??= loadAnonymousId();
  return anonymousIdPromise;
}

export async function readTelemetryQueue<T>() {
  const value = await AsyncStorage.getItem(telemetryQueueKey);
  if (!value) return [] as T[];
  try {
    const items = JSON.parse(value) as T[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [] as T[];
  }
}

export async function saveTelemetryQueue<T>(items: readonly T[]) {
  if (items.length) {
    await AsyncStorage.setItem(telemetryQueueKey, JSON.stringify(items));
  } else {
    await AsyncStorage.removeItem(telemetryQueueKey);
  }
}

export async function measureLocalStorage() {
  const keys = await AsyncStorage.getAllKeys();
  const entries = await AsyncStorage.multiGet(keys);
  const bytes = entries.reduce(
    (total, [key, value]) => total + key.length * 2 + (value?.length ?? 0) * 2,
    0,
  );
  return { keys: keys.length, bytes };
}

export async function clearNonEssentialStorage() {
  await AsyncStorage.multiRemove([telemetryQueueKey]);
  return measureLocalStorage();
}
