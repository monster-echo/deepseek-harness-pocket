import type { LegalDocument } from '@deepseek-harness-pocket/legal'

/**
 * 法务文档纯展示组件（无 Next 运行时依赖），供 [doc]/page.tsx 与 vitest 静态渲染共用。
 */

const styles = {
  page: {
    margin: '0 auto',
    maxWidth: 720,
    padding: '48px 24px 64px',
    color: '#111',
    lineHeight: 1.8,
  } as const,
  title: { fontSize: 28, fontWeight: 700, margin: '0 0 8px' } as const,
  summary: { color: '#444', margin: '0 0 4px' } as const,
  effective: { color: '#888', fontSize: 14, margin: '0 0 32px' } as const,
  section: { marginBottom: 28 } as const,
  sectionTitle: { fontSize: 19, fontWeight: 600, margin: '0 0 10px' } as const,
  paragraph: { margin: '0 0 10px' } as const,
  bullets: { margin: '0 0 10px', paddingLeft: 22 } as const,
  bullet: { marginBottom: 6 } as const,
} as const

export function LegalDocView({ document }: { document: LegalDocument }) {
  return (
    <main style={styles.page}>
      <h1 style={styles.title}>{document.title}</h1>
      <p style={styles.summary}>{document.summary}</p>
      <p style={styles.effective}>生效日期：{document.effectiveDate}</p>
      {document.sections.map((section) => (
        <section key={section.title} style={styles.section}>
          <h2 style={styles.sectionTitle}>{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} style={styles.paragraph}>
              {paragraph}
            </p>
          ))}
          {section.bullets ? (
            <ul style={styles.bullets}>
              {section.bullets.map((item) => (
                <li key={item} style={styles.bullet}>
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </main>
  )
}
