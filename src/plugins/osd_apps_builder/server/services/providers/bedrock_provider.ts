/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from '../../../../../core/server';
import { AIProvider, AppGenerationContext } from './types';
import {
  TOOL_DEFINITIONS,
  ToolResult,
  executeValidateCode,
  executePPL,
  executeGetIndexMetadata,
  executeGetSampleApp,
  executeGetPplReference,
  executeGetOuiComponents,
} from '../agent_tools';

const SYSTEM_PROMPT = `You are an OSD App Builder agent. You build React apps for OpenSearch Dashboards.

WORKFLOW:
1. Use get_index_metadata to understand the data schema
2. Use execute_ppl to test queries with real data
3. Use get_sample_app to see a working code pattern
4. Use get_oui_components for UI component examples if needed
5. Generate code following the exact patterns from sample apps
6. Use validate_code to check your code for errors
7. Fix any errors and re-validate until 0 errors
8. Call submit_app with the final validated code

CODE RULES:
- CommonJS only: var X = require('module'); exports.default = function(props) {...}
- React.createElement() for ALL UI — NO JSX syntax
- NO template literals (backticks) — use string concatenation with +
- NO import/export — use require() and exports.default
- Available modules: react, @elastic/eui, echarts, @osd-apps/api
- Use echarts directly (NOT echarts-for-react): var echarts = require('echarts');
- Create charts with useRef + echarts.init(): var chartRef = React.useRef(null); then in useEffect: var chart = echarts.init(chartRef.current); chart.setOption({...}); return function() { chart.dispose(); };
- Render chart container: React.createElement('div', { ref: chartRef, style: { height: '300px' } })
- @elastic/eui is the import alias for OUI (OpenSearch UI) components
- props.api.search({query, language:'PPL'}) for data — do NOT pass dataset
- Response format: { jsonData: [{...}, ...], size: N }
- Nested OTel fields are flattened: row['resource.attributes.service.name'] works

ALWAYS validate before submitting. ALWAYS test PPL queries with execute_ppl first.`;

const MAX_ITERATIONS = 15;

export class BedrockProvider implements AIProvider {
  public readonly id = 'bedrock';

  constructor(
    private readonly region: string,
    private readonly modelId: string,
    private readonly logger: Logger
  ) {}

  async *generateApp(prompt: string, context: AppGenerationContext): AsyncIterable<string> {
    let userMessage = prompt;
    if (context.dataSourceRefs?.length) {
      userMessage +=
        '\n\nSelected data sources: ' + context.dataSourceRefs.map((d: any) => d.title).join(', ');
    }
    yield* this.runAgent(userMessage, context);
  }

  async *refineApp(
    prompt: string,
    existingCode: string,
    context: AppGenerationContext
  ): AsyncIterable<string> {
    const userMessage = prompt + '\n\nExisting code to refine:\n' + existingCode;
    yield* this.runAgent(userMessage, context);
  }

  private async *runAgent(
    userMessage: string,
    context: AppGenerationContext
  ): AsyncIterable<string> {
    const { ConverseCommand, BedrockRuntimeClient } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const client = new BedrockRuntimeClient({ region: this.region });

    const messages: any[] = [{ role: 'user', content: [{ text: userMessage }] }];

    yield JSON.stringify({ status: 'Agent started...' });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      this.logger.info('Agent iteration ' + (i + 1));

      let response: any;
      try {
        response = await client.send(
          new ConverseCommand({
            modelId: this.modelId,
            system: [{ text: SYSTEM_PROMPT }],
            messages,
            toolConfig: { tools: TOOL_DEFINITIONS as any },
            inferenceConfig: { maxTokens: 8192 },
          })
        );
      } catch (err) {
        this.logger.error('Converse API error: ' + err);
        yield JSON.stringify({ error: 'Bedrock error: ' + err });
        return;
      }

      const outputMessage = response.output?.message;
      if (!outputMessage) {
        yield JSON.stringify({ error: 'No response from model' });
        return;
      }

      // Add assistant message to history
      messages.push({ role: 'assistant', content: outputMessage.content });

      const stopReason = response.stopReason;

      if (stopReason === 'tool_use') {
        const toolResults: any[] = [];

        for (const block of outputMessage.content) {
          if (!block.toolUse) continue;

          const { toolUseId, name, input } = block.toolUse;
          this.logger.info('Tool call: ' + name);

          // Emit tool_call event
          const inputSummary =
            name === 'validate_code' || name === 'submit_app'
              ? { lines: (input.code || '').split('\n').length }
              : input;
          yield JSON.stringify({ tool_call: { name, input: inputSummary } });

          // Handle submit_app specially
          if (name === 'submit_app') {
            const code = input.code || '';
            const validation = await executeValidateCode({ code });
            if (validation.content.indexOf('FAILED') >= 0) {
              // Not valid — tell agent to fix
              yield JSON.stringify({ tool_result: { name, summary: validation.summary } });
              toolResults.push({
                toolResult: {
                  toolUseId,
                  content: [
                    { text: validation.content + '\nDo NOT submit until validation passes.' },
                  ],
                },
              });
            } else {
              yield JSON.stringify({ tool_result: { name, summary: 'App submitted!' } });
              yield JSON.stringify({ chunk: code });
              yield JSON.stringify({ done: true });
              return;
            }
          } else {
            // Execute tool
            const result = await this.executeTool(name, input, context);
            yield JSON.stringify({ tool_result: { name, summary: result.summary } });
            toolResults.push({
              toolResult: { toolUseId, content: [{ text: result.content }] },
            });
          }
        }

        // Add tool results as user message
        messages.push({ role: 'user', content: toolResults });
      } else {
        // end_turn — extract code from text if present
        this.logger.info('Agent ended turn (no submit_app)');
        for (const block of outputMessage.content) {
          if (block.text) {
            // Try to extract code from the text response
            const code = this.extractCode(block.text);
            if (code) {
              yield JSON.stringify({ status: 'Extracting code from response...' });
              yield JSON.stringify({ chunk: code });
            }
          }
        }
        yield JSON.stringify({ done: true });
        return;
      }
    }

    yield JSON.stringify({ error: 'Agent reached max iterations (' + MAX_ITERATIONS + ')' });
  }

  private async executeTool(
    name: string,
    input: any,
    context: AppGenerationContext
  ): Promise<ToolResult> {
    const osClient = (context as any).opensearchClient;
    switch (name) {
      case 'validate_code':
        return executeValidateCode(input);
      case 'execute_ppl':
        return executePPL(input, osClient, this.logger);
      case 'get_index_metadata':
        return executeGetIndexMetadata(input, osClient, this.logger);
      case 'get_sample_app':
        return executeGetSampleApp(input);
      case 'get_ppl_reference':
        return executeGetPplReference();
      case 'get_oui_components':
        return executeGetOuiComponents(input);
      default:
        return { content: 'Unknown tool: ' + name, summary: 'Unknown tool' };
    }
  }

  private extractCode(text: string): string | null {
    // Try to find code between markdown fences
    const fenceMatch = text.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();
    // If text starts with var/exports, treat whole thing as code
    const trimmed = text.trim();
    if (trimmed.startsWith('var ') || trimmed.startsWith('exports.')) return trimmed;
    return null;
  }
}
