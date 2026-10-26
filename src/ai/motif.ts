import { z } from 'zod';
import { redact } from '../core/security.js';
import type { ChatMessage, ChatTool } from './deepseek.js';
import { MOTIF_BASE_URL, MOTIF_MODEL } from './providers.js';

const assistantSchema = z.object({ role: z.literal('assistant'), content: z.string().nullable(), reasoning_content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({ id: z.string().min(1), type: z.literal('function'), function: z.object({ name: z.string().min(1), arguments: z.string().max(100_000) }) })).max(8).optional() });

export class MotifError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Motif/Morfac client. The documented surface is Chat Completions only, without DeepSeek's reasoning controls. */
export class MotifClient {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch, private readonly signal?: AbortSignal) {}
  private async request(path: '/models' | '/chat/completions', body?: unknown) {
    let response: Response;
    try {
      response = await this.fetcher(`${MOTIF_BASE_URL}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${this.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([AbortSignal.timeout(body ? 120_000 : 30_000), ...(this.signal ? [this.signal] : [])]),
      });
    } catch { throw new MotifError(0, 'NETWORK_ERROR', 'Motif에 연결하지 못했습니다. 네트워크와 API 접근 상태를 확인하세요.'); }
    if (!response.ok) {
      // Provider errors may echo request data. Return only controlled messages.
      const messages: Record<number, string> = { 401: 'Motif API 키가 유효하지 않습니다.', 402: 'Motif 사용 크레딧이 부족합니다.', 403: 'Motif 접근 권한을 확인하세요.', 429: 'Motif 요청 한도에 도달했습니다. 잠시 후 다시 실행하세요.' };
      throw new MotifError(response.status, 'PROVIDER_ERROR', messages[response.status] ?? `Motif 요청 실패 (HTTP ${response.status}).`);
    }
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new MotifError(response.status, 'INVALID_RESPONSE', 'Motif 응답 형식이 올바르지 않습니다.'); }
  }
  async verifyModel() {
    const value = await this.request('/models');
    const models = Array.isArray(value.data) ? value.data as { id: string }[] : [];
    if (!models.some(model => model.id === MOTIF_MODEL)) throw new MotifError(200, 'MODEL_UNAVAILABLE', `이 계정에서 ${MOTIF_MODEL}을 사용할 수 없습니다. 다른 모델로 전환하지 않습니다.`);
    return { id: MOTIF_MODEL, name: MOTIF_MODEL };
  }
  async chat(messages: ChatMessage[], tools: ChatTool[]) {
    if (!messages.length || messages.length > 100 || tools.length > 10) throw new Error('AI 대화가 너무 길거나 도구 범위가 올바르지 않습니다. 새 대화를 시작하세요.');
    // DeepSeek adds reasoning_content to replayed messages; Motif does not document that field.
    const wire = messages.map(({ reasoning_content: _reasoning, ...message }) => message);
    const value = await this.request('/chat/completions', { model: MOTIF_MODEL, messages: wire, ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      max_tokens: 4096, stream: false });
    const choices = Array.isArray(value.choices) ? value.choices as { message?: unknown; finish_reason?: string }[] : [];
    const parsed = assistantSchema.safeParse(choices[0]?.message);
    if (!parsed.success || choices[0]?.finish_reason === 'length') throw new MotifError(200, 'INVALID_RESPONSE', 'Motif 도구 호출 응답이 올바르지 않거나 출력 한도를 초과했습니다.');
    return { message: redact(parsed.data, [this.apiKey]) as ChatMessage, requestedModel: MOTIF_MODEL, responseModel: redact(value.model, [this.apiKey]), usage: redact(value.usage, [this.apiKey]) };
  }
}
