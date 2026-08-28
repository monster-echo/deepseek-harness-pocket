import Link from 'next/link'
import { legalDocuments } from '@deepseek-harness-pocket/legal'

export const metadata = {
  title: '协议与政策 — 掌鲸 DSH Pocket',
  description: '掌鲸 DSH Pocket 隐私政策、用户协议与订阅说明。',
}

/**
 * 公网法务文档目录页（App Store 审核要求隐私政策为公网可访问 URL）。
 * 文档内容来自 @deepseek-harness-pocket/legal，与 App 内嵌文档同源。
 */
export default function LegalIndex() {
  return (
    <main style={{ margin: '0 auto', maxWidth: 720, padding: '48px 24px 64px', color: '#111', lineHeight: 1.8 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px' }}>协议与政策</h1>
      <p style={{ color: '#444', margin: '0 0 32px' }}>
        掌鲸 DSH Pocket 的隐私政策、用户协议与订阅说明。
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {legalDocuments.map((doc) => (
          <li
            key={doc.id}
            style={{ borderTop: '1px solid #eee', padding: '20px 0' }}
          >
            <Link
              href={`/legal/${doc.id}`}
              style={{ fontSize: 18, fontWeight: 600, color: '#B03C3C', textDecoration: 'none' }}
            >
              {doc.title}
            </Link>
            <p style={{ color: '#666', margin: '4px 0 0' }}>{doc.summary}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
