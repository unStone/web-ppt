import type { OpenEditorOptions } from './session';
import type {
  RecoveryCandidate, RecoveryDecisionHandler,
} from './recovery-store';

interface AdapterRecoveryHooks {
  active(): boolean;
  errorActive(): boolean;
  decision(): RecoveryDecisionHandler | undefined;
  recovering(candidate: RecoveryCandidate): void;
  opening(): void;
  errorHandler(): ((error: unknown) => void) | undefined;
  error(error: unknown): void;
}

function combineSignals(adapter: AbortSignal, configured: AbortSignal | undefined): AbortSignal {
  if (!configured) return adapter;
  if (configured.aborted) return configured;
  if (adapter.aborted) return adapter;
  const controller = new AbortController();
  const abortAdapter = () => controller.abort(adapter.reason);
  const abortConfigured = () => controller.abort(configured.reason);
  const cleanup = () => {
    adapter.removeEventListener('abort', abortAdapter);
    configured.removeEventListener('abort', abortConfigured);
  };
  adapter.addEventListener('abort', abortAdapter, { once: true });
  configured.addEventListener('abort', abortConfigured, { once: true });
  controller.signal.addEventListener('abort', cleanup, { once: true });
  return controller.signal;
}

/** 只编排宿主决策；指纹、日志和回放仍由 openEditor 独占。 */
export function bindAdapterRecovery(
  options: OpenEditorOptions | undefined,
  signal: AbortSignal,
  hooks: AdapterRecoveryHooks,
): OpenEditorOptions | undefined {
  if (!options?.recovery) return options;
  const configured = options.recovery;
  const combinedSignal = combineSignals(signal, configured.signal);
  return {
    ...options,
    recovery: {
      ...configured,
      signal: combinedSignal,
      onError: (error) => {
        if (!hooks.errorActive()) return;
        const handler = hooks.errorHandler();
        if (configured.onError && configured.onError !== handler) {
          try { configured.onError(error); } catch { /* 统一事件仍必须送达。 */ }
        }
        hooks.error(error);
      },
      decide: async (candidate) => {
        if (combinedSignal.aborted || !hooks.active()) return 'cancel';
        hooks.recovering(candidate);
        const decide = hooks.decision() ?? configured.decide;
        if (!decide) throw new Error('发现恢复日志，但 adapter 没有 onRecovery 决策回调');
        const decision = await decide(candidate);
        if (combinedSignal.aborted || !hooks.active()) return 'cancel';
        hooks.opening();
        return decision;
      },
    },
  };
}
