/**
 * Agent preset 目录（对齐 Web 的 Agent presets 设置区）。
 *
 * 宿主侧 `ctx.agentPresets.list()` 给出 preset 的 id / trust / 组成文件绝对路径；
 * bridge 读取组成文件正文（截断）随目录一起下发，让手机端能「查看这个预设由什么组成」。
 *
 * 说明：preset 的新建/复制/删除需要宿主 preset 根目录的写权限，
 * 属于桌面端职责，手机端只做只读查看与选择。
 */
/** 宽松解析 preset 列表；单条非法跳过，非数组返回 null。 */
export function parsePresets(value) {
    if (!Array.isArray(value))
        return null;
    const presets = [];
    for (const raw of value) {
        if (typeof raw !== 'object' || raw === null)
            continue;
        const p = raw;
        if (typeof p['id'] !== 'string' || p['id'].length === 0)
            continue;
        presets.push({
            id: p['id'],
            ...(typeof p['name'] === 'string' && p['name'].length > 0 ? { name: p['name'] } : {}),
            ...(typeof p['description'] === 'string' && p['description'].length > 0 ? { description: p['description'] } : {}),
            isDefault: p['isDefault'] === true,
            trust: p['trust'] === 'user' ? 'user' : 'system',
            ...(typeof p['broken'] === 'string' && p['broken'].length > 0 ? { broken: p['broken'] } : {}),
            ...(typeof p['composition'] === 'string' && p['composition'].length > 0
                ? { composition: p['composition'] }
                : {}),
        });
    }
    return presets;
}
//# sourceMappingURL=presets.js.map