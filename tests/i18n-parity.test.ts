import { describe, it, expect } from 'vitest';
import { MSG } from '@/lib/i18n';
import zh from '../public/_locales/zh_CN/messages.json';
import en from '../public/_locales/en/messages.json';

// i18n 三方一致性守卫（本 diff 杠杆最高的测试）：
// t() 在找不到键/空 message 时回退为原始键名显示给用户，所以任何漂移都会
// 把 'error_service_unavailable' 这样的原始键直接渲染到 UI。本测试把该失效模式锁死。
describe('i18n locale parity', () => {
  const zhKeys = Object.keys(zh);
  const enKeys = Object.keys(en);
  const msgKeys = Object.values(MSG);

  it('every MSG constant exists in both locales', () => {
    for (const key of msgKeys) {
      expect(zhKeys, `MSG key "${key}" missing from zh_CN`).toContain(key);
      expect(enKeys, `MSG key "${key}" missing from en`).toContain(key);
    }
  });

  it('zh_CN and en have identical key sets (no orphan in either side)', () => {
    const onlyZh = zhKeys.filter((k) => !enKeys.includes(k));
    const onlyEn = enKeys.filter((k) => !zhKeys.includes(k));
    expect(onlyZh, `keys only in zh_CN: ${onlyZh.join(', ')}`).toEqual([]);
    expect(onlyEn, `keys only in en: ${onlyEn.join(', ')}`).toEqual([]);
  });

  it('no locale has an empty message value (would fall back to raw key via t())', () => {
    for (const [key, entry] of Object.entries(zh)) {
      const msg = (entry as { message?: string }).message;
      expect(msg, `zh_CN "${key}" has empty message`).toBeTruthy();
    }
    for (const [key, entry] of Object.entries(en)) {
      const msg = (entry as { message?: string }).message;
      expect(msg, `en "${key}" has empty message`).toBeTruthy();
    }
  });
});
