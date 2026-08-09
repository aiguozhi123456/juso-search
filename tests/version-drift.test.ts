import { describe, it, expect } from 'vitest';
import packageJson from '../package.json';
import packageLock from '../package-lock.json';

/**
 * 版本号单一源门禁。
 *
 * 根因治理：历史上 package.json bump 后忘跑 `npm install`，导致
 * package-lock.json 的 version 字段落后于 package.json（真实 drift 曾发生：
 * package.json=1.4.0 而 lock=1.3.0）。此测试把"两者必须一致"固化为门禁，
 * 下次 bump 后若忘重锁，CI / 本地 `npm test` 会直接失败。
 *
 * package.json 是扩展版本号的唯一权威源（wxt.config.ts 不再硬编码 version，
 * WXT 自动从此处读取）。package-lock.json 由 npm 生成，应机械跟随。
 */
describe('version single-source gate', () => {
  it('package-lock.json version matches package.json version', () => {
    expect(packageLock.version).toBe(packageJson.version);
  });

  it('package-lock.json root package entry version matches package.json version', () => {
    expect(packageLock.packages[''].version).toBe(packageJson.version);
  });
});
