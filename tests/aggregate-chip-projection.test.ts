import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ProviderId } from '@/lib/providers/types';
import { aggregateSourcesOf, allSources, type SourceId } from '@/lib/sources';
import type { AggregateConfigSnapshot } from '@/lib/aggregate/types';
import type { SiteInstanceDefinition } from '@/lib/site-instances';
import type { CustomEngineDefinition } from '@/lib/custom-engines';
import type { ProviderInstance } from '@/lib/provider-instances';

// Lane G 回归锁（KTD16 / plan Verification 3）：SERP 栏与划词弹窗的聚合 chip 集与快切栏/右键菜单一致。
//
// 取舍说明：entrypoints/serp-bar.content.ts 与 entrypoints/selection-search.content.ts 没有
// 既有 content-script 测试 harness（既有测试只覆盖 lib 层：serp-bar-mount / serp-bar-layout /
// selection-search-dismiss / SelectionSearchPopup 组件）。按 Lane G 的指示**不新建重型
// content-script harness**，以两层等效回归锁替代：
//
//  1) **snapshot 驱动的投影层场景锁**：复刻两个 content script 的精确调用表达式
//     （serp-bar.content.ts:147-155 loadBarState / :595 applyConfigSnapshot 一侧、
//     selection-search.content.ts:143-151），以 ProviderConfigReply 形状的 config 驱动
//     「聚合实例增删 / 改成员致 eligibility 翻转 / rerank 配置变化」场景，断言 chip 集同步。
//     这锁定投影语义本身（eligibility 消费、literal label、隐藏/order 正交）。
//  2) **源码级穿透锁**（沿 tests/serp-bar-layout.test.ts 对 providerInstances 第 6 参的
//     既有先例）：三个调用点必须仍在 allSources 第 7 参传 `aggregateSourcesOf(config.aggregate)`。
//     第 7 参是带缺省的可选参数——掉参不会产生任何类型错误、其余测试全绿，只有穿透锁能拦住。
//
// 右键菜单（lib/context-menu.ts）不走本文件：它有真实 setupContextMenu harness
// （tests/context-menu.test.ts 的聚合 chip 场景组）端到端锁定。

const ENDPOINT = 'http://127.0.0.1:8000/v1/rerank';
const AGG = 'agg:chip1';

/** ProviderConfigReply 形状的最小 config（content script 只消费这些字段）。 */
interface ContentConfig {
  configuredProviderIds: ProviderId[];
  sourceOrder: SourceId[];
  sourceHidden: SourceId[];
  siteInstances: SiteInstanceDefinition[] | undefined;
  customEngines: CustomEngineDefinition[] | undefined;
  providerInstances: ProviderInstance[] | undefined;
  activeSourceId: string;
  aggregate: AggregateConfigSnapshot | undefined;
}

function config(overrides: Partial<ContentConfig> = {}): ContentConfig {
  return {
    configuredProviderIds: ['tavily'],
    sourceOrder: [],
    sourceHidden: [],
    siteInstances: undefined,
    customEngines: undefined,
    providerInstances: undefined,
    activeSourceId: 'google',
    aggregate: undefined,
    ...overrides,
  };
}

function aggSnapshot(overrides: Partial<AggregateConfigSnapshot> = {}): AggregateConfigSnapshot {
  return {
    instances: [{ id: AGG, name: '全家桶', members: ['tavily'], topN: 20 }],
    eligibility: { [AGG]: { eligible: true, validMembers: 1 } },
    rerank: { configured: true, hasApiKey: false, endpoint: ENDPOINT },
    ...overrides,
  };
}

/**
 * entrypoints/serp-bar.content.ts:595 与 entrypoints/selection-search.content.ts:143 的
 * 逐字调用表达式（含 `?? []` 回退）。保持与源码同形，任何一边改动都应该同步另一边。
 */
function projectSources(config_: ContentConfig): ReturnType<typeof allSources> {
  return allSources(
    config_.configuredProviderIds,
    config_.sourceOrder,
    config_.sourceHidden,
    config_.siteInstances ?? [],
    config_.customEngines ?? [],
    config_.providerInstances ?? [],
    aggregateSourcesOf(config_.aggregate),
  );
}

function chipIds(config_: ContentConfig): string[] {
  return projectSources(config_).map((source) => source.id);
}

describe('aggregate chip projection (serp-bar / selection-search equivalent lock, Lane G)', () => {
  it('projects the eligible aggregate chip from the config snapshot (AE1 四处一致的第一处)', () => {
    const ids = chipIds(config({ aggregate: aggSnapshot() }));
    expect(ids).toContain(AGG);
    const chip = projectSources(config({ aggregate: aggSnapshot() })).find((s) => s.id === AGG);
    expect(chip).toMatchObject({
      kind: 'aggregate-instance',
      label: '全家桶',
      labelDescriptor: { kind: 'literal', value: '全家桶' },
      favicon: '/icons/aggregate.svg',
    });
  });

  it('keeps the chip set in sync when an aggregate instance is added / deleted (增删同步)', () => {
    const two = aggSnapshot({
      instances: [
        { id: AGG, name: '全家桶', members: ['tavily'], topN: 20 },
        { id: 'agg:chip2', name: '技术区', members: ['tavily'], topN: 10 },
      ],
      eligibility: {
        [AGG]: { eligible: true, validMembers: 1 },
        'agg:chip2': { eligible: true, validMembers: 1 },
      },
    });
    expect(chipIds(config({ aggregate: two }))).toEqual(expect.arrayContaining([AGG, 'agg:chip2']));

    // 删除 agg:chip2（快照定义集去掉）→ chip 消失，兄弟实例与其余 chip 不动
    const afterDelete = config({ aggregate: aggSnapshot() });
    const ids = chipIds(afterDelete);
    expect(ids).not.toContain('agg:chip2');
    expect(ids).toContain(AGG);
    expect(ids).toContain('google');

    // 全删（AE9 前半）→ 聚合 chip 集为空
    expect(chipIds(config({ aggregate: aggSnapshot({ instances: [], eligibility: {} }) }))).not.toContain(AGG);
  });

  it('drops the chip when member validity flips eligibility off, restores it back (改成员)', () => {
    // 成员失效（如成员 provider key 清除 → eligibility 单点重算翻 false）
    const invalidated = aggSnapshot({ eligibility: { [AGG]: { eligible: false, validMembers: 0 } } });
    expect(chipIds(config({ aggregate: invalidated }))).not.toContain(AGG);
    // 成员恢复 → chip 复活
    expect(chipIds(config({ aggregate: aggSnapshot() }))).toContain(AGG);
  });

  it('drops every aggregate chip while the rerank endpoint is unconfigured (rerank 配置变化 = 隐式可见轴)', () => {
    const cleared = aggSnapshot({
      instances: [
        { id: AGG, name: '全家桶', members: ['tavily'], topN: 20 },
        { id: 'agg:chip2', name: '技术区', members: ['tavily'], topN: 10 },
      ],
      eligibility: {
        [AGG]: { eligible: false, validMembers: 1 },
        'agg:chip2': { eligible: false, validMembers: 1 },
      },
      rerank: { configured: false, hasApiKey: false },
    });
    const ids = chipIds(config({ aggregate: cleared }));
    expect(ids).not.toContain(AGG);
    expect(ids).not.toContain('agg:chip2');
    expect(ids).toContain('google'); // 非聚合 chip 不受影响
  });

  it('projects no aggregate chip when the config reply carries no aggregate field (老 worker / 缺省)', () => {
    expect(chipIds(config({ aggregate: undefined }))).not.toContain(AGG);
  });

  it('forwards the aggregate snapshot into every allSources call site of both content scripts (穿透锁)', async () => {
    // 沿 serp-bar-layout.test.ts 的 providerInstances 穿透锁先例：第 7 参缺省 = 无聚合 pill，
    // 掉参零类型错误、投影测试全绿——只有源码级断言能拦住回归。
    const serpBar = await readFile(resolve(process.cwd(), 'entrypoints/serp-bar.content.ts'), 'utf8');
    const selection = await readFile(resolve(process.cwd(), 'entrypoints/selection-search.content.ts'), 'utf8');

    // serp-bar 两处（loadBarState + applyConfigSnapshot）；selection-search 一处（showPopup）。
    const serpBarForwards = serpBar.match(/aggregateSourcesOf\((?:config|refreshed)\.aggregate\)/g);
    expect(serpBarForwards?.length).toBe(2);
    const selectionForwards = selection.match(/aggregateSourcesOf\(config\.aggregate\)/g);
    expect(selectionForwards?.length).toBe(1);
  });
});
