/**
 * Worker 配置视图（设置类，只读第一版）。
 *
 * 对齐 dsh 的 settings / credentials 两个宿主服务：
 *   - `settings.describe({ redactSecrets: true })`：命名空间当前值（秘密字段打码）
 *   - `credentials.listRecords()`：已登记的凭据**元信息**（绝不下发秘密值）
 *
 * 手机端只读展示；写操作留待后续（需要 settings mutation + CAS revision）。
 */
export function parseSettingsUpdateOutcome(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    if (v['updated'] === true && typeof v['revision'] === 'number') {
        return { updated: true, revision: v['revision'] };
    }
    if (v['updated'] === false && v['conflict'] === true) {
        return {
            updated: false,
            conflict: true,
            actualRevision: typeof v['actualRevision'] === 'number' ? v['actualRevision'] : 0,
        };
    }
    return null;
}
const PREVIEW_LIMIT = 800;
function previewOf(value) {
    try {
        const json = JSON.stringify(value ?? null);
        if (json === undefined)
            return '—';
        return json.length > PREVIEW_LIMIT ? `${json.slice(0, PREVIEW_LIMIT)}…` : json;
    }
    catch {
        return '—';
    }
}
/** 宽松解析设置命名空间列表；单条非法跳过，非数组返回 null。 */
export function parseSettingsSections(value) {
    if (!Array.isArray(value))
        return null;
    const sections = [];
    for (const raw of value) {
        if (typeof raw !== 'object' || raw === null)
            continue;
        const s = raw;
        if (typeof s['ns'] !== 'string')
            continue;
        const secrets = s['secrets'];
        const hasSecrets = Array.isArray(secrets) && secrets.length > 0;
        let valueJson;
        if (!hasSecrets) {
            try {
                valueJson = JSON.stringify(s['value'] ?? null, null, 2);
            }
            catch {
                valueJson = undefined;
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
        });
    }
    return sections;
}
/** 宽松解析凭据记录列表；单条非法跳过，非数组返回 null。 */
export function parseCredentialRecords(value) {
    if (!Array.isArray(value))
        return null;
    const records = [];
    for (const raw of value) {
        if (typeof raw !== 'object' || raw === null)
            continue;
        const r = raw;
        const key = r['key'];
        if (key === undefined || key === null)
            continue;
        records.push({
            key: typeof key === 'string' ? key : String(key),
            kind: typeof r['kind'] === 'string' ? r['kind'] : 'unknown',
            configured: r['configured'] === true,
            ...(typeof r['source'] === 'string' && r['source'].length > 0 ? { source: r['source'] } : {}),
            writable: r['writable'] === true,
        });
    }
    return records;
}
//# sourceMappingURL=settings.js.map