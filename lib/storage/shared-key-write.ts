import { withSourceMutation } from './source-graph-store';
import { withProviderKeysMutation } from './provider-keys-store';
import { withProviderMaxResultsMutation } from './max-results-store';

/**
 * 共享键（当前仅 MAX_RESULTS_KEY）全部写者的唯一合法获取顺序。
 *
 * 锁序依据见 docs/solutions/logic-errors/instance-crud-cross-queue-lock-order.md。
 * 新增共享键写者必须走本原语，不得自行组合队列。
 */
export function withSharedKeyWrite<T>(fn: () => Promise<T>): Promise<T> {
  return withSourceMutation(() => withProviderKeysMutation(() => withProviderMaxResultsMutation(fn)));
}
