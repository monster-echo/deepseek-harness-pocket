import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { privacyPolicy } from '@deepseek-harness-pocket/legal'
import LegalIndex from '../src/app/legal/page'
import LegalDocPage from '../src/app/legal/[doc]/page'
import { LegalDocView } from '../src/app/legal/LegalDocView'

/** 静态渲染公网法务页面，校验 ASC 审核可见的关键内容。 */
function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node)
}

describe('公网法务页面', () => {
  it('目录页列出全部文档并链接到对应路由', () => {
    const html = render(createElement(LegalIndex))
    expect(html).toContain('协议与政策')
    expect(html).toContain('隐私政策')
    expect(html).toContain('用户协议')
    expect(html).toContain('订阅与自动续期说明')
    expect(html).toContain('/legal/privacy')
    expect(html).toContain('/legal/terms')
    expect(html).toContain('/legal/subscription')
  })

  it('文档页渲染标题、生效日期与全部章节', () => {
    const html = render(createElement(LegalDocView, { document: privacyPolicy }))
    expect(html).toContain('隐私政策')
    expect(html).toContain('生效日期')
    expect(html).toContain('儿童隐私')
    expect(html).toContain('你的选择与权利')
  })

  it('动态路由页按 id 渲染对应文档', async () => {
    // 异步 Server Component 不能直接静态渲染，先 await 取返回的元素
    const node = await LegalDocPage({ params: Promise.resolve({ doc: 'terms' }) })
    const html = render(node)
    expect(html).toContain('用户协议')
    expect(html).toContain('会员与自动续期订阅')
  })

  it('未知 id 走 404', async () => {
    await expect(
      LegalDocPage({ params: Promise.resolve({ doc: 'nope' }) }),
    ).rejects.toThrow()
  })
})
