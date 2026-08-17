import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import {
  clearNonEssentialStorage,
  measureLocalStorage,
} from '../data/storage';
import { telemetry } from '../telemetry/Telemetry';

type StorageSummary = Readonly<{ keys: number; bytes: number }>;
export type StorageClearResult = Readonly<{
  before: StorageSummary;
  after: StorageSummary;
  bytesFreed: number;
}>;

export function useStorageMaintenance() {
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await measureLocalStorage());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const clear = useCallback(async (): Promise<StorageClearResult> => {
    setLoading(true);
    try {
      const before = await measureLocalStorage();
      await telemetry.clearRegenerableCache();
      const after = await clearNonEssentialStorage();
      setSummary(after);
      return {
        before,
        after,
        bytesFreed: Math.max(0, before.bytes - after.bytes),
      };
    } finally {
      setLoading(false);
    }
  }, []);
  return { summary, loading, refresh, clear };
}

export async function openSystemSettings() {
  if (Platform.OS === 'web') return false;
  await Linking.openSettings();
  return true;
}
