// IU6 packager 测试：mock browser.runtime / global.fetch，spy createStoreZip 断言
// 传入的 entry（不重实现 zip reader）。镜像 background-handlers.test.ts /
// storage.test.ts 的 vi.stubGlobal('browser', ...) 模式。
import { readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { packageAgentSkill } from '@/lib/agent-skill-packager';
import { createStoreZip } from '@/lib/zip';
import type { ZipEntry } from '@/lib/zip';

// spy on createStoreZip（包装真实实现）：只断言传入的 entry，不重实现 zip reader。
vi.mock('@/lib/zip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zip')>();
  return {
    ...actual,
    createStoreZip: vi.fn(actual.createStoreZip),
  };
});

const FAKE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'; // 31 个 a + b = 32，合法 [a-p]{32}
const FIREFOX_ID = 'juso-search@extension'; // Firefox gecko ID email-style
const VERSION = '1.3.0';

const SKILL_MD_FIXTURE =
  '---\nname: juso-search\n---\n\n# Juso Search\n\nextension: __JUSO_EXTENSION_ID__\nbridge: __JUSO_BRIDGE_URL__\n';
const PY_FIXTURE = 'DEFAULT_EXTENSION_ID = "__JUSO_EXTENSION_ID__"\nDEFAULT_BRIDGE_URL = "__JUSO_BRIDGE_URL__"\n';
// 真实 juso_bridge.py 无占位符（drift 锁在 test_gen_skills.py 断言四处字节相等）；fixture
// 故意带一个占位符，保住"每个 zip 内文件都被盖章 + 零占位符残留"这条既有不变量的覆盖。
const BRIDGE_PY_FIXTURE = 'PROTOCOL = 2\n# stamped marker: __JUSO_EXTENSION_ID__\n# bridge: __JUSO_BRIDGE_URL__\n';
const REFERENCE_FIXTURE = '# Reference\n\nstamped id: __JUSO_EXTENSION_ID__\nbridge: __JUSO_BRIDGE_URL__\n';

const decode = (entry: ZipEntry): string => new TextDecoder().decode(entry.data);

/** 安装带指定 runtime id 的 browser 全局（镜像 background-handlers.test.ts 的 getURL 形态）。 */
function stubBrowser(id: string, scheme = 'chrome-extension', host?: string): void {
  vi.stubGlobal('browser', {
    runtime: {
      id,
      getURL: (p: string) => `${scheme}://${host ?? id}/${p.replace(/^\//, '')}`,
      getManifest: () => ({ version: VERSION }),
    },
  });
}

beforeEach(() => {
  stubBrowser(FAKE_ID);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('agent-skill/SKILL.md')) return { text: async () => SKILL_MD_FIXTURE };
      if (url.endsWith('agent-skill/scripts/juso_search.py'))
        return { text: async () => PY_FIXTURE };
      if (url.endsWith('agent-skill/scripts/juso_bridge.py'))
        return { text: async () => BRIDGE_PY_FIXTURE };
      if (url.includes('/agent-skill/reference/'))
        return { text: async () => REFERENCE_FIXTURE };
      throw new Error(`unexpected fetch url: ${url}`);
    }),
  );
  // spy on createStoreZip：只断言传入的 entry，不重实现 zip reader。
  vi.mocked(createStoreZip).mockClear();
});

describe('packageAgentSkill', () => {
  it('prod: stamps the runtime id into all skill files (SKILL.md, script, reference/*) and builds a zip data url', async () => {
    const { dataUrl, filename } = await packageAgentSkill('prod');

    expect(filename).toBe(`juso-search-${VERSION}.zip`);
    expect(dataUrl.startsWith('data:application/zip;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan('data:application/zip;base64,'.length);

    expect(createStoreZip).toHaveBeenCalledTimes(1);
    const entries = vi.mocked(createStoreZip).mock.calls[0][0];
    expect(entries).toHaveLength(7);
    expect(entries.map((e) => e.path)).toEqual([
      'juso-search/SKILL.md',
      'juso-search/scripts/juso_search.py',
      'juso-search/scripts/juso_bridge.py',
      'juso-search/reference/engines.md',
      'juso-search/reference/errors.md',
      'juso-search/reference/configuration.md',
      'juso-search/reference/provider-instances.md',
    ]);

    // 每个 entry 都盖章了 fake id，且占位符零残留（断言 5：成功调用必然无占位符）。
    for (const entry of entries) {
      expect(decode(entry)).toContain(FAKE_ID);
      expect(decode(entry)).not.toContain('__JUSO_EXTENSION_ID__');
      expect(decode(entry)).not.toContain('__JUSO_BRIDGE_URL__');
    }
  });

  it('zip round-trip: contains BOTH scripts/juso_search.py and scripts/juso_bridge.py (same scripts/ sub-structure)', async () => {
    await packageAgentSkill('prod');

    const entries = vi.mocked(createStoreZip).mock.calls[0][0];
    const scriptEntries = entries.filter((e) => e.path.startsWith('juso-search/scripts/'));
    expect(scriptEntries.map((e) => e.path).sort()).toEqual([
      'juso-search/scripts/juso_bridge.py',
      'juso-search/scripts/juso_search.py',
    ]);
    // juso_bridge.py 也走同一盖章通路：占位符盖章为 runtime id，零残留。
    const bridge = scriptEntries.find((e) => e.path.endsWith('/juso_bridge.py'));
    expect(bridge).toBeDefined();
    expect(decode(bridge!)).toContain(FAKE_ID);
    expect(decode(bridge!)).not.toContain('__JUSO_EXTENSION_ID__');
    expect(decode(bridge!)).not.toContain('__JUSO_BRIDGE_URL__');
  });

  it('dev: filename carries the dev token but the zip folder stays juso-search', async () => {
    const { dataUrl, filename } = await packageAgentSkill('dev');

    expect(filename).toBe(`juso-search-dev-${VERSION}.zip`);
    expect(dataUrl.startsWith('data:application/zip;base64,')).toBe(true);

    const entries = vi.mocked(createStoreZip).mock.calls[0][0];
    // 顶层文件夹统一 juso-search，dev variant 也不变成 juso-search-dev。
    expect(entries.map((e) => e.path)).toEqual([
      'juso-search/SKILL.md',
      'juso-search/scripts/juso_search.py',
      'juso-search/scripts/juso_bridge.py',
      'juso-search/reference/engines.md',
      'juso-search/reference/errors.md',
      'juso-search/reference/configuration.md',
      'juso-search/reference/provider-instances.md',
    ]);
    expect(entries.some((e) => e.path.startsWith('juso-search-dev'))).toBe(false);
    for (const entry of entries) {
      expect(decode(entry)).toContain(FAKE_ID);
      expect(decode(entry)).not.toContain('__JUSO_EXTENSION_ID__');
      expect(decode(entry)).not.toContain('__JUSO_BRIDGE_URL__');
    }
  });

  it('custom (non-preset) runtime id is stamped verbatim', async () => {
    const custom = 'cccccccccccccccccccccccccccccccc'; // 合法 [a-p]{32}，非任一预置 id
    stubBrowser(custom);

    const { filename } = await packageAgentSkill('prod');
    expect(filename).toBe(`juso-search-${VERSION}.zip`);

    const entries = vi.mocked(createStoreZip).mock.calls[0][0];
    expect(entries.map((e) => e.path)).toEqual([
      'juso-search/SKILL.md',
      'juso-search/scripts/juso_search.py',
      'juso-search/scripts/juso_bridge.py',
      'juso-search/reference/engines.md',
      'juso-search/reference/errors.md',
      'juso-search/reference/configuration.md',
      'juso-search/reference/provider-instances.md',
    ]);
    for (const entry of entries) {
      expect(decode(entry)).toContain(custom);
      expect(decode(entry)).not.toContain('__JUSO_EXTENSION_ID__');
      expect(decode(entry)).not.toContain('__JUSO_BRIDGE_URL__');
    }
  });

  it('accepts a Firefox email-style extension id and stamps bridge URL', async () => {
    stubBrowser(FIREFOX_ID, 'moz-extension', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    await packageAgentSkill('prod');
    const entries = vi.mocked(createStoreZip).mock.calls[0][0];
    for (const entry of entries) {
      expect(decode(entry)).toContain(FIREFOX_ID);
      expect(decode(entry)).not.toContain('__JUSO_EXTENSION_ID__');
      expect(decode(entry)).not.toContain('__JUSO_BRIDGE_URL__');
    }
    const py = decode(entries.find((e) => e.path.endsWith('juso_search.py'))!);
    expect(py).toContain('moz-extension://a1b2c3d4-e5f6-7890-abcd-ef1234567890/bridge.html');
  });

  it('throws on an invalid extension id and does not fetch or zip', async () => {
    stubBrowser('not-a-valid-id');

    await expect(packageAgentSkill('prod')).rejects.toThrow(
      /invalid extension id "not-a-valid-id"/,
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(createStoreZip).not.toHaveBeenCalled();
  });

  it('REFERENCE_FILES matches the actual public/agent-skill/reference/ directory (cross-end drift lock)', async () => {
    // 守卫：packager 打进 zip 的 reference 文件必须 == 模板实际目录。防止加了
    // reference 文件却忘更新 REFERENCE_FILES（下载 zip 残缺），或反之（清单多余）。
    const actual = readdirSync('public/agent-skill/reference')
      .filter((f) => f.endsWith('.md'))
      .sort();
    await packageAgentSkill('prod');
    const entries = vi.mocked(createStoreZip).mock.calls[0][0];
    const zipped = entries
      .filter((e) => e.path.startsWith('juso-search/reference/'))
      .map((e) => e.path.replace('juso-search/reference/', ''))
      .sort();
    expect(zipped).toEqual(actual);
  });
});
