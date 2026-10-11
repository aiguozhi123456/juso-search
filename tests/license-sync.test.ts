import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * public/LICENSE 与根 LICENSE 的 drift-lock。
 *
 * public/ 由 WXT 原样拷入扩展包，是随扩展分发的许可证通知；根 LICENSE 是仓库的
 * 管辖许可。二者是手工维护的孪生（对齐 CONCEPTS.md「Drift-lock」：手工孪生必须有
 * 字节相等门禁），单侧改动（如补版权头）曾会静默分叉——此测试把"必须逐字节一致"
 * 固化为门禁。两份内容必须都是 canonical MPL 2.0 文本，不允许本地改写。
 */
const rootLicense = readFileSync(resolve(process.cwd(), 'LICENSE'), 'utf8');
const publicLicense = readFileSync(resolve(process.cwd(), 'public/LICENSE'), 'utf8');

describe('LICENSE drift-lock', () => {
  it('public/LICENSE stays byte-identical to root LICENSE', () => {
    expect(publicLicense).toBe(rootLicense);
  });

  it('LICENSE carries the canonical MPL 2.0 notice line (https, not http)', () => {
    expect(rootLicense).toContain('You can obtain one at https://mozilla.org/MPL/2.0/.');
    expect(rootLicense).not.toContain('http://mozilla.org/MPL/2.0/');
  });
});
