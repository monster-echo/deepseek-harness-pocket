import { useEffect, useState } from "react";
import { onWorkerStatus, workerStatus, type WorkerStatus } from "./worker";

/**
 * 订阅 Worker 状态：先取一次，之后跟随 Rust 侧轮询推送。
 * 全 app 唯一状态源 —— 页面不要再自建定时轮询（Rust 侧已在推，重复轮询是双倍空转）。
 */
export function useWorkerStatus(): WorkerStatus | null {
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void workerStatus().then((s) => alive && setStatus(s));
    const unlisten = onWorkerStatus((s) => alive && setStatus(s));
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  return status;
}
