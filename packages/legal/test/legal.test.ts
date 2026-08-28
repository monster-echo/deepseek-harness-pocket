import { describe, expect, it } from 'vitest'
import {
  getLegalDocument,
  legalDocuments,
  privacyPolicy,
  subscriptionTerms,
  termsOfService,
} from '../src/index'

describe('法务文档内容完整性', () => {
  it('包含三份文档：隐私政策 / 用户协议 / 订阅说明', () => {
    expect(legalDocuments.map((doc) => doc.id)).toEqual(['privacy', 'terms', 'subscription'])
    expect(privacyPolicy.title).toBe('隐私政策')
    expect(termsOfService.title).toBe('用户协议')
    expect(subscriptionTerms.title).toBe('订阅与自动续期说明')
  })

  it('每份文档都有生效日期、摘要，且章节标题与正文非空', () => {
    for (const doc of legalDocuments) {
      expect(doc.effectiveDate.trim()).not.toBe('')
      expect(doc.summary.trim()).not.toBe('')
      expect(doc.sections.length).toBeGreaterThan(0)
      for (const section of doc.sections) {
        expect(section.title.trim()).not.toBe('')
        const hasBody =
          section.paragraphs.some((p) => p.trim() !== '') ||
          (section.bullets?.some((b) => b.trim() !== '') ?? false)
        expect(hasBody).toBe(true)
      }
    }
  })

  it('隐私政策覆盖 ASC 必备声明：数据收集、儿童隐私、联系方式、账号删除', () => {
    const text = privacyPolicy.sections.map((s) => [s.title, ...s.paragraphs, ...(s.bullets ?? [])].join('\n')).join('\n')
    expect(text).toContain('儿童')
    expect(text).toContain('注销账号')
    expect(text).toContain('帮助与反馈')
    expect(text).toContain('数据')
  })

  it('getLegalDocument 命中已知 id，未知 id 返回 undefined', () => {
    expect(getLegalDocument('privacy')?.title).toBe('隐私政策')
    expect(getLegalDocument('nope')).toBeUndefined()
  })
})
