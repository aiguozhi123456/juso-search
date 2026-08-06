// 运行时 Agent Skill 打包器（IU6）。
//
// 从随包分发的模板（public/agent-skill/，见计划 KTD1）读取 SKILL.md 与
// scripts/juso_search.py，把 `__JUSO_EXTENSION_ID__` 占位符盖章为当前扩展的
// browser.runtime.id（自定义 dev 构建的 ID 也可正确盖章，计划 KTD4），经 STORE-mode
// zip（顶层统一文件夹 juso-search，计划 R7/KTD5）打包成 data URL + 文件名，供 worker
// 触发 browser.downloads.download（IU7）。
//
// 纯 worker-side，模板为无密钥文本资源，全程不经手任何 BYOK key（计划 R10）。

import { createStoreZip, type ZipEntry } from './zip';

export type AgentSkillVariant = 'prod' | 'dev';

const PLACEHOLDER = '__JUSO_EXTENSION_ID__';
const EXTENSION_ID_RE = /^[a-p]{32}$/;
const TOP_LEVEL_DIR = 'juso-search';
const ZIP_DATA_URL_PREFIX = 'data:application/zip;base64,';

/** 把 text 中所有占位符替换为 extId。extId 已由 `[a-p]{32}` 校验，无需正则转义。 */
function stamp(text: string, extId: string): string {
  return text.split(PLACEHOLDER).join(extId);
}

/** Uint8Array → base64。分块拼接规避长数组展开的调用栈上限；btoa 在 MV3 worker 与 jsdom 均可用。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 读取模板 → 盖章 runtime extension id → STORE zip → data URL + 文件名。
 *
 * variant 仅决定 zip 文件名 token（prod 不带 / dev 带 `-dev`）；zip 内部 skill
 * 恒为 `juso-search`，内容统一 prod 风格（模板本身即 prod 内容，仅扩展 ID 占位，
 * 见计划 IU6 实现注记）。
 */
export async function packageAgentSkill(
  variant: AgentSkillVariant,
): Promise<{ dataUrl: string; filename: string }> {
  const extId = browser.runtime.id;
  if (!EXTENSION_ID_RE.test(extId)) {
    throw new Error(
      `invalid extension id "${extId}": expected 32 lowercase letters a-p (got a dev/custom build? the runtime id is the authoritative stamping source)`,
    );
  }

  const version = browser.runtime.getManifest().version;

  // WXT 把 getURL 的类型签名收窄为 PublicPath；运行期接受任意扩展内相对路径，
  // 此处按 lib/sources.ts 的既有模式展开类型。
  const getUrl = browser.runtime.getURL as (p: string) => string;

  const skillMd = await (await fetch(getUrl('agent-skill/SKILL.md'))).text();
  const py = await (await fetch(getUrl('agent-skill/scripts/juso_search.py'))).text();

  const skillMdStamped = stamp(skillMd, extId);
  const pyStamped = stamp(py, extId);
  if (skillMdStamped.includes(PLACEHOLDER) || pyStamped.includes(PLACEHOLDER)) {
    throw new Error(`template drift: "${PLACEHOLDER}" still present after stamping`);
  }

  const entries: ZipEntry[] = [
    { path: `${TOP_LEVEL_DIR}/SKILL.md`, data: new TextEncoder().encode(skillMdStamped) },
    { path: `${TOP_LEVEL_DIR}/scripts/juso_search.py`, data: new TextEncoder().encode(pyStamped) },
  ];
  const zipBytes = createStoreZip(entries);

  const dataUrl = `${ZIP_DATA_URL_PREFIX}${bytesToBase64(zipBytes)}`;
  const filename =
    variant === 'dev' ? `juso-search-dev-${version}.zip` : `juso-search-${version}.zip`;

  return { dataUrl, filename };
}
