/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { HttpStart } from '../../../../core/public';
import { ROUTES } from '../../common/constants';

export interface GenerateOptions {
  onStatus?: (message: string) => void;
  onWarning?: (message: string) => void;
  onToolCall?: (name: string, input: any) => void;
  onToolResult?: (name: string, summary: string) => void;
}

export class AIClient {
  constructor(private http: HttpStart) {}

  async *generate(
    prompt: string,
    context?: { indexMetadata?: any[]; dataSourceRefs?: any[]; exampleCode?: string },
    options?: GenerateOptions
  ): AsyncGenerator<string> {
    yield* this.stream(ROUTES.GENERATE, { prompt, context }, options);
  }

  async *refine(
    prompt: string,
    existingCode: string,
    context?: { indexMetadata?: any[]; dataSourceRefs?: any[]; exampleCode?: string },
    options?: GenerateOptions
  ): AsyncGenerator<string> {
    yield* this.stream(ROUTES.REFINE, { prompt, existingCode, context }, options);
  }

  private async *stream(
    path: string,
    body: object,
    options?: GenerateOptions
  ): AsyncGenerator<string> {
    const response = await fetch(window.location.origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'osd-xsrf': 'true' },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error('AI request failed: ' + response.statusText);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.error) throw new Error(data.error);
        if (data.status) options?.onStatus?.(data.status);
        if (data.warning) options?.onWarning?.(data.warning);
        if (data.tool_call) options?.onToolCall?.(data.tool_call.name, data.tool_call.input);
        if (data.tool_result)
          options?.onToolResult?.(data.tool_result.name, data.tool_result.summary);
        if (data.done) return;
        if (data.chunk) yield data.chunk;
      }
    }
  }
}
