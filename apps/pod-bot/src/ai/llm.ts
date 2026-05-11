import OpenAI from 'openai';

/**
 * LLM client. Uses NVIDIA NIM by default (OpenAI-compatible host of Llama, Qwen,
 * Nemotron, MiniMax, DeepSeek-R1, etc.). Swap base URL + model to use OpenAI,
 * Anthropic-via-proxy, or local.
 */

export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class LLM {
  private readonly client: OpenAI;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;

  constructor(config: LLMConfig) {
    if (!config.apiKey) {
      throw new Error('LLM: apiKey is required');
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://integrate.api.nvidia.com/v1',
    });
    this.model = config.model ?? 'meta/llama-3.3-70b-instruct';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 600;
  }

  async complete(params: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const result = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      temperature: params.temperature ?? this.temperature,
      max_tokens: params.maxTokens ?? this.maxTokens,
      top_p: 0.95,
    });
    const content = result.choices[0]?.message?.content;
    if (!content) throw new Error('LLM: empty completion');
    return content.trim();
  }

  /** Stream tokens as they arrive — used for "I'm thinking…" UX. */
  async *stream(params: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): AsyncGenerator<string, void> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      temperature: params.temperature ?? this.temperature,
      max_tokens: params.maxTokens ?? this.maxTokens,
      top_p: 0.95,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
