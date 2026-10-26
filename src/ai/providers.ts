import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from './credentials.js';
import type { ChatMessage, ChatTool } from './deepseek.js';

/** Motif (Morfac) exposes only an OpenAI-compatible Chat Completions surface. */
export const MOTIF_BASE_URL = 'https://api-cbt.morphfactory.io/v1' as const;
export const MOTIF_MODEL = 'motif/motif-3' as const;
export const MOTIF_DOCS_URL = 'https://cbt.morphfactory.io/docs/en/chat-completions' as const;

export const providerIds = ['deepseek', 'motif'] as const;
export type ProviderId = (typeof providerIds)[number];
export const DEFAULT_PROVIDER: ProviderId = 'deepseek';

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  model: string;
  baseUrl: string;
  keyEnv: 'DEEPSEEK_API_KEY' | 'MORPH_API_KEY';
  /** Motif keys are read from `.env` only; DeepSeek also accepts a locally encrypted key. */
  environmentOnly: boolean;
  docs: string;
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  deepseek: { id: 'deepseek', label: 'DeepSeek', model: DEEPSEEK_MODEL, baseUrl: DEEPSEEK_BASE_URL, keyEnv: 'DEEPSEEK_API_KEY', environmentOnly: false, docs: 'https://api-docs.deepseek.com' },
  motif: { id: 'motif', label: 'Motif', model: MOTIF_MODEL, baseUrl: MOTIF_BASE_URL, keyEnv: 'MORPH_API_KEY', environmentOnly: true, docs: MOTIF_DOCS_URL },
};

export interface ChatCompletion { message: ChatMessage; requestedModel: string; responseModel: unknown; usage: unknown }
/** Shared shape of the tool-calling clients, so a conversation can pin either provider. */
export interface ProviderClient { chat(messages: ChatMessage[], tools: ChatTool[]): Promise<ChatCompletion> }

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (providerIds as readonly string[]).includes(value);
}

/** Unknown providers are rejected instead of silently falling back to another model. */
export function parseProvider(value: unknown): ProviderId {
  if (value === undefined || value === null || value === '') return DEFAULT_PROVIDER;
  if (!isProviderId(value)) throw new Error('AI 공급자는 deepseek 또는 motif 중 하나여야 합니다.');
  return value;
}

/** Environment keys are trimmed; an empty value counts as not configured. */
export function environmentKey(provider: ProviderId, environment: NodeJS.ProcessEnv): string | null {
  const value = environment[PROVIDERS[provider].keyEnv]?.trim();
  return value ? value : null;
}
