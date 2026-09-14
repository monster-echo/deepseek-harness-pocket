/**
 * Worker 配置视图（设置类，只读第一版）。
 *
 * 对齐 dsh 的 settings / credentials 两个宿主服务：
 *   - `settings.describe({ redactSecrets: true })`：命名空间当前值（秘密字段打码）
 *   - `credentials.listRecords()`：已登记的凭据**元信息**（绝不下发秘密值）
 *
 * 手机端只读展示；写操作留待后续（需要 settings mutation + CAS revision）。
 */

export interface SettingsSectionInfo {
  readonly ns: string
  /** 生效时机（owner 声明） */
  readonly applies: string
  /** 原始用户层的单调修订号（写操作需回传） */
  readonly revision: number
  /** 是否有用户层覆盖 */
  readonly overridden: boolean
  /** 当前值的 JSON 预览（已截断；秘密字段由宿主打码） */
  readonly preview: string
  /**
   * 是否可在手机端编辑。
   * schema 声明了秘密字段的命名空间一律为 false——打码后的占位值一旦回写
   * 会把真实密钥覆盖成占位符，所以这一类只读展示，密钥请走凭据页面。
   */
  readonly editable: boolean
  /** 可编辑时的完整值 JSON（已打码；不可编辑时缺省） */
  readonly valueJson?: string
}

/** `settings.update` 的结果：成功给新修订号，版本冲突给当前修订号。 */
export type SettingsUpdateOutcome =
  | { readonly updated: true; readonly revision: number }
  | { readonly updated: false; readonly conflict: true; readonly actualRevision: number }

export function parseSettingsUpdateOutcome(value: unknown): SettingsUpdateOutcome | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v['updated'] === true && typeof v['revision'] === 'number') {
    return { updated: true, revision: v['revision'] }
  }
  if (v['updated'] === false && v['conflict'] === true) {
    return {
      updated: false,
      conflict: true,
      actualRevision: typeof v['actualRevision'] === 'number' ? v['actualRevision'] : 0,
    }
  }
  return null
}

export interface CredentialRecordInfo {
  readonly key: string
  readonly kind: string
  /** 当前是否已配置（空值不算配置） */
  readonly configured: boolean
  /** 当前提供值的来源层（env / file / …），未配置时缺省 */
  readonly source?: string
  /** 当前 provider 是否允许写这个引用 */
  readonly writable: boolean
}

const PREVIEW_LIMIT = 800

function previewOf(value: unknown): string {
  try {
    const json = JSON.stringify(value ?? null)
    if (json === undefined) return '—'
    return json.length > PREVIEW_LIMIT ? `${json.slice(0, PREVIEW_LIMIT)}…` : json
  } catch {
    return '—'
  }
}

/** 宽松解析设置命名空间列表；单条非法跳过，非数组返回 null。 */
export function parseSettingsSections(value: unknown): readonly SettingsSectionInfo[] | null {
  if (!Array.isArray(value)) return null
  const sections: SettingsSectionInfo[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const s = raw as Record<string, unknown>
    if (typeof s['ns'] !== 'string') continue
    const secrets = s['secrets']
    const hasSecrets = Array.isArray(secrets) && secrets.length > 0
    let valueJson: string | undefined
    if (!hasSecrets) {
      try {
        valueJson = JSON.stringify(s['value'] ?? null, null, 2)
      } catch {
        valueJson = undefined
      }
    }
    sections.push({
      ns: s['ns'],
      applies: typeof s['applies'] === 'string' ? s['applies'] : 'unknown',
      revision: typeof s['revision'] === 'number' ? s['revision'] : 0,
      overridden: s['user'] !== undefined && s['user'] !== null,
      preview: previewOf(s['value']),
      editable: !hasSecrets,
      ...(valueJson !== undefined ? { valueJson } : {}),
    })
  }
  return sections
}

/** 宽松解析凭据记录列表；单条非法跳过，非数组返回 null。 */
export function parseCredentialRecords(value: unknown): readonly CredentialRecordInfo[] | null {
  if (!Array.isArray(value)) return null
  const records: CredentialRecordInfo[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const key = r['key']
    if (key === undefined || key === null) continue
    records.push({
      key: typeof key === 'string' ? key : String(key),
      kind: typeof r['kind'] === 'string' ? r['kind'] : 'unknown',
      configured: r['configured'] === true,
      ...(typeof r['source'] === 'string' && r['source'].length > 0 ? { source: r['source'] } : {}),
      writable: r['writable'] === true,
    })
  }
  return records
}
