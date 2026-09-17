import { useEffect, useState } from "react";
import { onWorkerStatus, workerStatus, type WorkerStatus } from "../lib/worker";

/** 订阅 Worker 状态：先取一次，之后跟随 Rust 侧轮询推送。 */
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

export function formatBytes(n: number): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatTime(sec?: number): string {
  if (!sec) return "—";
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
