export const metadata = {
  title: '掌鲸 DSH Pocket Gateway',
  description: '手机上的 DeepSeek Harness 客户端 — 中转服务',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  )
}
