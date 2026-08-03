// AI engine 注入结构不变量测试（M1 host 收敛防漂移）。
//
// 锁住「registry / host 表 / INJECTORS / matches 声明」四者的一致性，防未来漂移：
//   - 每个 inject 型 engine 在 host 表里有且仅有一项指向它（反向也无多余项）；
//   - host 表每项都指向已注册的 inject 型 engine，且其 execution.injectorKey 存在于 INJECTORS；
//   - INJECTORS 无死条目——每个 injectorKey 都被 registry 的某个 inject engine 引用；
//   - INJECT_MATCH_PATTERNS 条目数 === host 表条目数。
// 新增注入站漏改任一处的结构性错误会在这些测试里立即暴露（而非线上静默死功能）。

import { describe, expect, it } from 'vitest';
import type { AiEngine, InjectExecution } from '@/lib/ai-engines/types';
import {
  HOST_TO_ENGINE_ID,
  INJECT_MATCH_PATTERNS,
  INJECTORS,
} from '@/lib/ai-engines/injectors';
import { allAiEngines, getAiEngine, isRegisteredAiEngineId } from '@/lib/ai-engines/registry';

/** inject 分支收窄后的 engine 类型。 */
type InjectEngine = AiEngine & { execution: InjectExecution };

/** registry 中全部 inject 型 engine（execution.kind === 'inject'）。 */
function listInjectEngines(): InjectEngine[] {
  return allAiEngines().filter((e): e is InjectEngine => e.execution.kind === 'inject');
}

describe('AI engine 注入结构不变量（M1 host 收敛）', () => {
  it('每个 inject 型 engine 在 host 表里有且仅有一项指向它', () => {
    const injectEngines = listInjectEngines();
    const tableEngineIds = Object.values(HOST_TO_ENGINE_ID);

    for (const engine of injectEngines) {
      expect(tableEngineIds.filter((id) => id === engine.id)).toHaveLength(1);
    }
    // 反向：host 表不允许多余项（条目数 = inject 型 engine 数）
    expect(tableEngineIds).toHaveLength(injectEngines.length);
  });

  it('host 表每项都指向已注册的 inject 型 engine，且其 injectorKey 存在于 INJECTORS', () => {
    for (const engineId of Object.values(HOST_TO_ENGINE_ID)) {
      expect(isRegisteredAiEngineId(engineId)).toBe(true);
      const engine = getAiEngine(engineId);
      if (engine.execution.kind !== 'inject') {
        throw new Error(`host 表指向了非 inject 型 engine: ${engineId}`);
      }
      expect(engine.execution.injectorKey in INJECTORS).toBe(true);
    }
  });

  it('INJECTORS 无死条目：每个 injectorKey 都被 registry 的某个 inject engine 引用', () => {
    const usedKeys = listInjectEngines().map((e) => e.execution.injectorKey);
    for (const key of Object.keys(INJECTORS)) {
      expect(usedKeys).toContain(key);
    }
  });

  it('INJECT_MATCH_PATTERNS 条目数 === host 表条目数', () => {
    expect(INJECT_MATCH_PATTERNS).toHaveLength(Object.keys(HOST_TO_ENGINE_ID).length);
  });
});
