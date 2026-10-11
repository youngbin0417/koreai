import type { Action, Executor } from '../types.js';

/** Local source extensions run with the engine's OS permissions. Review before importing. */
export interface ReviewedExtension {
  actions: Action[];
  executor: Executor;
}

/** Add explicit imports and entries here after reviewing each extension's source. */
export const reviewedExtensions: ReviewedExtension[] = [];

export interface ActionRegistry {
  readonly actions: ReadonlyMap<string, Action>;
  register(actions: Action[], executor: Executor): void;
}

/** Check the entire set first, so a collision never silently replaces a bundled action. */
export function registerReviewedExtensions(
  registry: ActionRegistry,
  extensions: readonly ReviewedExtension[] = reviewedExtensions,
): void {
  const ids = new Set(registry.actions.keys());
  for (const extension of extensions) {
    for (const action of extension.actions) {
      if (ids.has(action.id)) throw new Error(`중복된 확장 행동 ID: ${action.id}`);
      ids.add(action.id);
    }
  }
  for (const extension of extensions) registry.register(extension.actions, extension.executor);
}
