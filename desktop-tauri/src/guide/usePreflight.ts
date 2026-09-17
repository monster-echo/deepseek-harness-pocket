import { useCallback, useEffect, useState } from "react";
import { preflightCheck, type PreflightReport } from "../lib/worker";

/** 引导页环境预检：mount 时跑一次；每个修复动作完成后 refresh() 重新体检。 */
export function usePreflight() {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await preflightCheck());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { report, loading, error, refresh };
}
