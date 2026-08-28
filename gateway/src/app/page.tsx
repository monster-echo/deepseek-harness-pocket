export default function Home() {
  return (
    <main style={{ padding: 48, color: '#111' }}>
      <h1>掌鲸 DSH Pocket Gateway</h1>
      <p>手机上的 DeepSeek Harness 客户端 — 中转服务运行中。</p>
      <ul style={{ lineHeight: 1.8 }}>
        <li>Worker uplink: <code>wss://…/gw/worker</code></li>
        <li>手机接入: <code>wss://…/gw/phone</code></li>
        <li>健康检查: <code>/api/v1/health</code></li>
        <li>
          <a href="/legal" style={{ color: '#B03C3C' }}>协议与政策</a>
        </li>
      </ul>
    </main>
  )
}
