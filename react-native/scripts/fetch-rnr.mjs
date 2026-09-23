/**
 * 从 RNR 官方 registry 拉取 ui 组件与 blocks 到 src/ 下。
 *
 * 用法：node scripts/fetch-rnr.mjs
 * 需要外网（本机走代理时：https_proxy=http://127.0.0.1:7897）。
 *
 * 落盘映射：
 *   .../components/ui/x.tsx -> src/components/ui/x.tsx
 *   .../blocks/x.tsx        -> src/components/blocks/x.tsx
 *   .../lib/x.ts            -> src/lib/x.ts
 * 并把 `@/registry/<style>/...` 改写成项目别名 `@/...`。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://reactnativereusables.com/r/uniwind';

const COMPONENTS = [
  'accordion', 'alert-dialog', 'alert', 'aspect-ratio', 'avatar', 'badge', 'button',
  'card', 'checkbox', 'collapsible', 'context-menu', 'dialog', 'dropdown-menu',
  'hover-card', 'input', 'label', 'menubar', 'popover', 'progress', 'radio-group',
  'select', 'separator', 'skeleton', 'switch', 'tabs', 'text', 'textarea',
  'toggle', 'toggle-group', 'tooltip',
];

const BLOCKS = [
  'sign-in-form', 'sign-up-form', 'social-connections', 'forgot-password-form',
  'reset-password-form', 'verify-email-form',
];

const seen = new Set();

function rewrite(content) {
  return content
    .replaceAll('@/registry/nativewind/components/ui/', '@/components/ui/')
    .replaceAll('@/registry/uniwind/components/ui/', '@/components/ui/')
    .replaceAll('@/registry/nativewind/blocks/', '@/components/blocks/')
    .replaceAll('@/registry/uniwind/blocks/', '@/components/blocks/')
    .replaceAll('@/registry/blocks/', '@/components/blocks/')
    .replaceAll('@/registry/nativewind/lib/', '@/lib/')
    .replaceAll('@/registry/uniwind/lib/', '@/lib/');
}

function targetFor(path) {
  const file = path.split('/').pop();
  if (path.includes('/components/ui/')) return join(ROOT, 'src/components/ui', file);
  if (path.includes('/blocks/')) return join(ROOT, 'src/components/blocks', file);
  if (path.includes('/lib/')) return join(ROOT, 'src/lib', file);
  throw new Error(`unmapped registry path: ${path}`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function install(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const item = await fetchJson(`${BASE}/${name}.json`);
  for (const dep of item.registryDependencies ?? []) {
    const depName = dep.split('/').pop().replace(/\.json$/, '');
    await install(depName);
  }
  for (const file of item.files ?? []) {
    const target = targetFor(file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, rewrite(file.content), 'utf8');
    console.log(`wrote ${target.replace(`${ROOT}/`, '')}`);
  }
}

for (const name of [...COMPONENTS, ...BLOCKS]) {
  await install(name);
}
console.log(`done: ${seen.size} registry items`);
