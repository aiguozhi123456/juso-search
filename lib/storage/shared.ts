import type { EngineId } from '../engines/types';
import type { ProviderId } from '../providers/types';
import { allProviders } from '../providers/registry';
import type { SourceId } from '../sources';
import { visibleUsableSource } from '../sources';
import type { SiteEngineDefinition } from '../site-engines';
import type { CustomEngineDefinition } from '../custom-engines';
import type { ProviderInstance } from '../provider-instances';

export const DEFAULT_ENGINE_ID: EngineId = 'google';

export function isKnownProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && allProviders().some((p) => p.id === id);
}

/** Normalizes a proposal rather than persisting a switcher with no usable item. */
export function ensureVisibleUsable(hidden: SourceId[], order: SourceId[], keys: unknown, definitions: readonly SiteEngineDefinition[], customDefinitions: readonly CustomEngineDefinition[] = [], instances: readonly ProviderInstance[] = []): SourceId[] {
  const keyMap = (keys ?? {}) as Record<string, string>;
  if (visibleUsableSource(order, hidden, keyMap, definitions, customDefinitions, instances)) return hidden;
  const fallback = visibleUsableSource(order, [], keyMap, definitions, customDefinitions, instances);
  return fallback ? hidden.filter((id) => id !== fallback) : hidden;
}
