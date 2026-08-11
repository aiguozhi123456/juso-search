// 运行时 Agent Skill 打包器（IU6）。
//
// 从随包分发的模板（public/agent-skill/，见计划 KTD1）读取 SKILL.md、
// scripts/juso_search.py、scripts/juso_bridge.py 与 reference/ 子目录下的章节文件，
// 把 `__JUSO_EXTENSION_ID__` 占位符盖章为当前扩展的 browser.runtime.id（自定义 dev
// 构建的 ID 也可正确盖章，计划 KTD4），把 `__JUSO_BRIDGE_URL__` 占位符盖章为
// browser.runtime.getURL('bridge.html')（Firefox 的 moz-extension:// host 是 per-install
// 随机 UUID，不可从 ID 推导，必须盖印完整 URL），经 STORE-mode zip（顶层统一文件夹
// juso-search，计划 R7/KTD5）打包成 data URL + 文件名，供 worker 触发
// browser.downloads.download（IU7）。
//
// 纯 worker-side，模板为无密钥文本资源，全程不经手任何 BYOK key（计划 R10）。

import { createStoreZip, type ZipEntry } from './zip';

export type AgentSkillVariant = 'prod' | 'dev';

const PLACEHOLDER = '__JUSO_EXTENSION_ID__';
const BRIDGE_URL_PLACEHOLDER = '__JUSO_BRIDGE_URL__';
// Chrome: 32 lowercase letters a-p（由 key/公钥派生）；Firefox: email-style（如 juso-search@extension）或 {GUID}。
const EXTENSION_ID_RE = /^(?:[a-p]{32}|[a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+|\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\})$/;
const TOP_LEVEL_DIR = 'juso-search';
const ZIP_DATA_URL_PREFIX = 'data:application/zip;base64,';

// reference/ 子目录下的章节文件清单（固定契约，与 SKILL.md 一同入 zip）。
const REFERENCE_FILES = ['engines.md', 'errors.md', 'configuration.md', 'provider-instances.md'] as const;

/** 把 text 中所有 placeholder 替换为 value。使用 split/join（非 replace），无需正则转义。 */
function stamp(text: string, placeholder: string, value: string): string {
  return text.split(placeholder).join(value);
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
      `invalid extension id "${extId}": expected Chrome [a-p]{32}, Firefox email-style, or {GUID}`,
    );
  }

  const version = browser.runtime.getManifest().version;

  // WXT 把 getURL 的类型签名收窄为 PublicPath；运行期接受任意扩展内相对路径，
  // 此处按 lib/sources.ts 的既有模式展开类型。
  const getUrl = browser.runtime.getURL as (p: string) => string;
  // 完整 bridge URL（Chrome: chrome-extension://{id}/bridge.html；Firefox: moz-extension://{uuid}/bridge.html）。
  // Python 侧用此 URL 作为 base，追加 #v=1&p={port}&t={token} fragment。
  const bridgeUrl = getUrl('bridge.html');

  const skillMd = await (await fetch(getUrl('agent-skill/SKILL.md'))).text();
  const py = await (await fetch(getUrl('agent-skill/scripts/juso_search.py'))).text();
  // juso_bridge.py 是共享/不 patch 的 sibling 源（无 __JUSO_EXTENSION_ID__ 占位符），
  // 与 juso_search.py 一同进 zip 的 scripts/ 子结构（单源模块，见 plan KTD2/IU2）。
  const bridgePy = await (await fetch(getUrl('agent-skill/scripts/juso_bridge.py'))).text();

  const referenceEntries = await Promise.all(
    REFERENCE_FILES.map(async (name) => {
      const text = await (await fetch(getUrl(`agent-skill/reference/${name}`))).text();
      return { name, text };
    }),
  );

  const skillMdStamped = stamp(stamp(skillMd, PLACEHOLDER, extId), BRIDGE_URL_PLACEHOLDER, bridgeUrl);
  const pyStamped = stamp(stamp(py, PLACEHOLDER, extId), BRIDGE_URL_PLACEHOLDER, bridgeUrl);
  const bridgePyStamped = stamp(stamp(bridgePy, PLACEHOLDER, extId), BRIDGE_URL_PLACEHOLDER, bridgeUrl);
  if (skillMdStamped.includes(PLACEHOLDER) || pyStamped.includes(PLACEHOLDER) || bridgePyStamped.includes(PLACEHOLDER)) {
    throw new Error(`template drift: "${PLACEHOLDER}" still present after stamping`);
  }
  if (skillMdStamped.includes(BRIDGE_URL_PLACEHOLDER) || pyStamped.includes(BRIDGE_URL_PLACEHOLDER) || bridgePyStamped.includes(BRIDGE_URL_PLACEHOLDER)) {
    throw new Error(`template drift: "${BRIDGE_URL_PLACEHOLDER}" still present after stamping`);
  }

  const referenceStamped = referenceEntries.map(({ name, text }) => {
    const stamped = stamp(stamp(text, PLACEHOLDER, extId), BRIDGE_URL_PLACEHOLDER, bridgeUrl);
    if (stamped.includes(PLACEHOLDER)) {
      throw new Error(`template drift: "${PLACEHOLDER}" still present in reference/${name} after stamping`);
    }
    if (stamped.includes(BRIDGE_URL_PLACEHOLDER)) {
      throw new Error(`template drift: "${BRIDGE_URL_PLACEHOLDER}" still present in reference/${name} after stamping`);
    }
    return { name, text: stamped };
  });

  const entries: ZipEntry[] = [
    { path: `${TOP_LEVEL_DIR}/SKILL.md`, data: new TextEncoder().encode(skillMdStamped) },
    { path: `${TOP_LEVEL_DIR}/scripts/juso_search.py`, data: new TextEncoder().encode(pyStamped) },
    { path: `${TOP_LEVEL_DIR}/scripts/juso_bridge.py`, data: new TextEncoder().encode(bridgePyStamped) },
    ...referenceStamped.map(({ name, text }) => ({
      path: `${TOP_LEVEL_DIR}/reference/${name}`,
      data: new TextEncoder().encode(text),
    })),
  ];
  const zipBytes = createStoreZip(entries);

  const dataUrl = `${ZIP_DATA_URL_PREFIX}${bytesToBase64(zipBytes)}`;
  const filename =
    variant === 'dev' ? `juso-search-dev-${version}.zip` : `juso-search-${version}.zip`;

  return { dataUrl, filename };
}
