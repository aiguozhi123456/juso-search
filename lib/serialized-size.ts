/**
 * UTF-8 JSON byte length of a value; Infinity when stringify fails.
 *
 * 单点实现：持久化集合的字节预算守卫（site / provider / aggregate / custom-engine）
 * 与整包导入体积上限（config-io）共用同一份口径——口径漂移会让导入拒绝阈值与
 * 持久化写入守卫互相打架。
 */
export function serializedSize(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return Infinity; }
}
