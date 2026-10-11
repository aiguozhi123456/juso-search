import { serializedSize } from './serialized-size';

/**
 * 动态 source id 的 token 规则——inst:/site:/custom:/agg: 四族共享的单一定义点
 * （worker 生成的 UUID 满足此形态）。收紧/放宽 id 规则只需改这一处，
 * 否则四条实例管线会静默漂移。
 */
export const INSTANCE_ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * 由固定前缀 + token 构造 id 形态守卫（site:/custom:/agg: 三族同构；
 * inst: 前缀内嵌 provider id，结构不同，仅复用 token）。
 */
export function makeInstanceIdGuard(prefix: string): (id: string) => boolean {
  return (id) => id.startsWith(prefix) && INSTANCE_ID_TOKEN.test(id.slice(prefix.length));
}

/**
 * 不可信导入/配置载荷的严格上界守卫（数量 + 序列化字节）——四条实例管线的
 * isBounded*Collection 共用实现，仅常量不同。
 */
export function isBoundedInstanceCollection(value: unknown, max: number, maxBytes: number): value is unknown[] {
  return Array.isArray(value) && value.length <= max && serializedSize(value) <= maxBytes;
}

/**
 * 防御式存储归一化的共享实现——site / provider / aggregate / custom-engine 四类集合共用
 * 同一条管线（normalizeItem → 丢弃非法/非对象 → 按 id 去重保留首现 → 上限截断）。
 *
 * `dedupeKey` 是可选的第二把去重键（site 的 (engine, 模式, scope, zhannei 指纹)、
 * custom 的 urlTemplate）；返回 null 的项一律丢弃。
 *
 * 体积语义：可信存储读**逐项归一**，绝不因体积把整个集合判为空——否则一次
 * create/update/delete 就会用小数组重写存储、抹掉数据。字节超限不是这里的拒绝条件；
 * 只有不可信导入/配置路径才用各实体的 `isBounded*Collection` 拒绝（那里才谈上限）。
 * 数量超限则按 `max` 截断并保留首现顺序（预期行为，由各调用方测试钉住）。
 */
export function normalizeInstanceCollection<T extends { id: string }>(
  value: unknown,
  normalizeItem: (item: unknown) => T | null,
  max: number,
  dedupeKey?: (item: T) => string | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const normalized: T[] = [];
  for (const item of value) {
    const entity = normalizeItem(item);
    if (!entity || seenIds.has(entity.id)) continue;
    if (dedupeKey) {
      const key = dedupeKey(entity);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    seenIds.add(entity.id);
    normalized.push(entity);
    if (normalized.length >= max) break;
  }
  return normalized;
}
