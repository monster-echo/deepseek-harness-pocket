import { GuidePage } from "./guide/GuidePage";
import { ConsoleApp } from "./console/ConsoleApp";

/**
 * 双窗口共用同一份前端产物，按 URL 参数分流：
 *   index.html                     → 主窗口（引导面；Worker 就绪后由 Rust 导航到 dsh Web GUI）
 *   index.html?window=console&panel=… → 控制台窗口（托盘进入）
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("window") === "console") {
    return <ConsoleApp initialPanel={params.get("panel") ?? "status"} />;
  }
  return <GuidePage />;
}
