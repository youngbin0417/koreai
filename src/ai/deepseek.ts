import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from './credentials.js';
import { redact } from '../core/security.js';
import { z } from 'zod';

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[]; reasoning_content?: string | null }
export interface ChatTool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
const assistantSchema = z.object({ role: z.literal('assistant'), content: z.string().nullable(), reasoning_content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({ id: z.string().min(1), type: z.literal('function'), function: z.object({ name: z.string().min(1), arguments: z.string().max(100_000) }) })).max(8).optional() });

export class DeepSeekError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export class DeepSeekClient {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch, private readonly signal?: AbortSignal) {}
  private async request(path: '/models' | '/responses' | '/chat/completions', body?: unknown) {
    let response: Response;
    try {
      response = await this.fetcher(`${DEEPSEEK_BASE_URL}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${this.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([AbortSignal.timeout(body ? 120_000 : 30_000), ...(this.signal ? [this.signal] : [])]),
      });
    } catch { throw new DeepSeekError(0, 'NETWORK_ERROR', 'DeepSeek에 연결하지 못했습니다. 네트워크와 API 접근 상태를 확인하세요.'); }
    if (!response.ok) {
      // Provider errors may echo request data. Return only controlled messages.
      const messages: Record<number, string> = { 401: 'DeepSeek API 키가 유효하지 않습니다.', 402: 'DeepSeek 잔액이 부족합니다.', 403: 'DeepSeek 접근 권한을 확인하세요.', 429: 'DeepSeek 요청 한도에 도달했습니다. 잠시 후 다시 실행하세요.' };
      throw new DeepSeekError(response.status, 'PROVIDER_ERROR', messages[response.status] ?? `DeepSeek 요청 실패 (HTTP ${response.status}).`);
    }
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new DeepSeekError(response.status, 'INVALID_RESPONSE', 'DeepSeek 응답 형식이 올바르지 않습니다.'); }
  }
  async verifyModel() {
    const value = await this.request('/models');
    const models = Array.isArray(value.data) ? value.data as { id: string; name?: string }[] : [];
    const model = models.find(m => m.id === DEEPSEEK_MODEL);
    if (!model) throw new DeepSeekError(200, 'MODEL_UNAVAILABLE', '이 계정에서 deepseek-flash를 사용할 수 없습니다. 다른 모델로 전환하지 않습니다.');
    return { id: DEEPSEEK_MODEL, name: String(redact(model.name ?? 'DeepSeek-V4.1-Flash', [this.apiKey])) };
  }
  async respond(input: string, effort: 'low' | 'high' | 'max' = 'high', maxOutputTokens = 4096) {
    if (!input.trim() || input.length > 100_000) throw new Error('입력은 1~100000자여야 합니다.');
    if (!['low', 'high', 'max'].includes(effort)) throw new Error('추론 강도는 low, high, max 중 하나여야 합니다.');
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > 8192) throw new Error('출력 토큰 한도는 16~8192여야 합니다.');
    const value = await this.request('/responses', { model: DEEPSEEK_MODEL, input, reasoning: { effort }, max_output_tokens: maxOutputTokens, stream: false, store: false });
    const output = Array.isArray(value.output) ? value.output as { type?: string; content?: { type?: string; text?: string }[] }[] : [];
    const text = output.filter(x => x.type === 'message').flatMap(x => x.content ?? []).filter(x => x.type === 'output_text').map(x => x.text ?? '').join('');
    if (!text) throw new DeepSeekError(200, 'EMPTY_RESPONSE', 'DeepSeek 응답에 최종 텍스트가 없습니다.');
    return { text: String(redact(text, [this.apiKey])), model: DEEPSEEK_MODEL, status: redact(value.status, [this.apiKey]), usage: redact(value.usage, [this.apiKey]) };
  }
  async chat(messages: ChatMessage[], tools: ChatTool[]) {
    if (!messages.length || messages.length > 100 || tools.length > 10) throw new Error('AI 대화가 너무 길거나 도구 범위가 올바르지 않습니다. 새 대화를 시작하세요.');
    const value = await this.request('/chat/completions', { model: DEEPSEEK_MODEL, messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 4096, stream: false });
    const choices = Array.isArray(value.choices) ? value.choices as { message?: unknown; finish_reason?: string }[] : [];
    const parsed = assistantSchema.safeParse(choices[0]?.message);
    if (!parsed.success || choices[0]?.finish_reason === 'length') throw new DeepSeekError(200, 'INVALID_RESPONSE', 'DeepSeek 도구 호출 응답이 올바르지 않거나 출력 한도를 초과했습니다.');
    return { message: redact(parsed.data, [this.apiKey]) as ChatMessage, requestedModel: DEEPSEEK_MODEL, responseModel: redact(value.model, [this.apiKey]), usage: redact(value.usage, [this.apiKey]) };
  }
}
