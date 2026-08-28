import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getLegalDocument, legalDocuments } from '@deepseek-harness-pocket/legal'
import { LegalDocView } from '../LegalDocView'

/** 预渲染全部文档为静态页 */
export function generateStaticParams() {
  return legalDocuments.map((doc) => ({ doc: doc.id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>
}): Promise<Metadata> {
  const { doc } = await params
  const document = getLegalDocument(doc)
  return {
    title: document ? `${document.title} — 掌鲸 DSH Pocket` : '文档不存在',
    description: document?.summary,
  }
}

export default async function LegalDocPage({
  params,
}: {
  params: Promise<{ doc: string }>
}) {
  const { doc } = await params
  const document = getLegalDocument(doc)
  if (!document) {
    notFound()
  }
  return <LegalDocView document={document} />
}
