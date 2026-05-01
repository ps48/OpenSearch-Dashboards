# OSD Apps Builder — Agentic Architecture Design

## Overview

Replace the current pipeline approach (generate → validate → repair loop) with an **agentic approach** where the LLM drives the process using tools via Bedrock Converse API. The agent decides when to validate, test queries, fetch references, and iterate.

## Architecture

```
User prompt + selected datasets
        ↓
   OSD Server (Agent Loop)
        ↓
   Bedrock Converse API (with toolUse)
        ↓
   Agent has tools:
   ┌─────────────────────────────────────────┐
   │ validate_code(code)     → errors[]      │
   │ execute_ppl(query)      → jsonData[]    │
   │ get_index_metadata(idx) → fields, docs  │
   │ get_sample_app(type)    → working code  │
   │ get_ppl_reference()     → PPL syntax    │
   │ get_oui_components(cat) → EUI examples  │
   │ submit_app(code)        → DONE          │
   └─────────────────────────────────────────┘
        ↓
   Agent loop: LLM calls tools, gets results,
   iterates until it calls submit_app()
        ↓
   Client receives: status updates during thinking,
   then final validated code
```

## Bedrock Converse API

Uses ConverseCommand with tool definitions:

```typescript
const response = await client.send(new ConverseCommand({
  modelId,
  system: [{ text: systemPrompt }],
  messages: conversationHistory,
  toolConfig: { tools: toolDefinitions },
}));
// stopReason: 'tool_use' → process tool calls, continue
// stopReason: 'end_turn' → done
```

## Tools

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| validate_code | code: string | { valid, errors[] } | AST security validation |
| execute_ppl | query: string | { jsonData[], size } | Test PPL queries with real data |
| get_index_metadata | index: string | { fields[], sampleDocs[] } | Understand data schema |
| get_sample_app | type: string | working code string | Reference implementation |
| get_ppl_reference | (none) | PPL syntax docs | Query language help |
| get_oui_components | category?: string | Component examples | UI component reference (EUI alias for OUI) |
| submit_app | code: string | DONE signal | Final validated output |

## Agent Loop

1. Build initial message with user prompt + dataset context
2. Send to Bedrock Converse with tool definitions
3. Loop (max 15 iterations):
   - If stopReason == 'tool_use': execute tools, append results, continue
   - If tool is 'submit_app': validate final time, stream to client, DONE
   - If stopReason == 'end_turn': extract any code, done (fallback)
4. Stream status updates to client during loop

## System Prompt (Simplified — agent fetches references on demand)

```
You are an OSD App Builder agent. Build React apps for OpenSearch Dashboards.

WORKFLOW:
1. get_index_metadata → understand the data
2. execute_ppl → test queries with real data
3. get_sample_app → see working code patterns
4. Generate code following exact patterns
5. validate_code → check for errors
6. Fix errors, re-validate
7. submit_app → deliver final code

CODE RULES:
- CommonJS: var X = require('module'); exports.default = function(props) {...}
- React.createElement() only, NO JSX, NO backticks
- @elastic/eui is the import alias for OUI (OpenSearch UI)
- props.api.search({query, language:'PPL'}) — do NOT pass dataset
- Response: { jsonData: [{...}], size: N }

ALWAYS validate before submitting. ALWAYS test PPL queries first.
```

## Client Changes

- "Agent is working..." with real-time activity log
- Each tool call shown: "Testing PPL query...", "Validating code..."
- No partial code preview — only final result after submit_app
- Activity log shows tool calls and result summaries

## Files to Change

- server/services/providers/bedrock_provider.ts → Converse API + tool loop
- server/services/providers/types.ts → Update AIProvider interface
- server/services/agent_tools.ts → NEW: Tool implementations
- server/services/oui_reference.ts → NEW: OUI component examples
- server/services/ppl_reference.ts → NEW: PPL syntax reference
- server/routes/generate.ts → Run agent, stream status + final code

---

## Detailed Implementation Plan

### Task A: Tool Implementations (server/services/agent_tools.ts)

Create a single file with all tool executor functions:

```typescript
interface ToolResult {
  content: string;  // Text result sent back to the LLM
  summary: string;  // Short summary for the client activity log
}

// Each tool function:
async function executeValidateCode(input: { code: string }): ToolResult
async function executePPL(input: { query: string }, opensearchClient): ToolResult
async function executeGetIndexMetadata(input: { index: string }, opensearchClient): ToolResult
async function executeGetSampleApp(input: { type: string }): ToolResult
async function executeGetPplReference(): ToolResult
async function executeGetOuiComponents(input: { category?: string }): ToolResult
// submit_app is handled specially in the agent loop (not a tool executor)
```

Tool implementations:
- `validate_code` → reuses existing `validateCode()` from code_validator.ts
- `execute_ppl` → calls OpenSearch PPL endpoint directly via the opensearch client
- `get_index_metadata` → reuses existing index_metadata route logic
- `get_sample_app` → returns code from sample_apps registry
- `get_ppl_reference` → returns static PPL syntax reference string
- `get_oui_components` → returns static OUI component examples by category

### Task B: Reference Data Files

**server/services/ppl_reference.ts**
- Static string with condensed PPL command reference
- Commands: source, where, fields, stats, sort, head, dedup, eval, rename, top, rare, parse, join
- Functions: aggregation, string, date, math
- Example queries

**server/services/oui_reference.ts**
- Static strings organized by category: layout, data-display, forms, charts, navigation
- Each category has React.createElement examples (NOT JSX)
- Covers: EuiFlexGroup, EuiPanel, EuiStat, EuiBasicTable, EuiSelect, EuiFieldSearch, EuiBadge, EuiTabs, ReactECharts
- Notes that @elastic/eui is the import alias for OUI

### Task C: Bedrock Converse Provider (server/services/providers/bedrock_provider.ts)

Rewrite to use Bedrock Converse API:

```typescript
class BedrockProvider implements AIProvider {
  // Tool definitions array for Converse API
  private toolDefinitions: ToolConfiguration;
  
  async *generateApp(prompt, context): AsyncIterable<string> {
    // 1. Build system prompt (simplified — agent fetches refs on demand)
    // 2. Build initial user message with prompt + dataset info
    // 3. Agent loop (max 15 iterations):
    //    a. Call Converse API
    //    b. If stopReason == 'tool_use':
    //       - yield status event for each tool call
    //       - Execute tool, get result
    //       - yield tool_result event
    //       - Append tool results to messages
    //       - Continue loop
    //    c. If tool is 'submit_app':
    //       - Run final validation
    //       - yield the code as chunk
    //       - Break
    //    d. If stopReason == 'end_turn':
    //       - Extract any code from text response
    //       - Break (fallback)
    // 4. yield done event
  }
}
```

Key Converse API details:
- Import: `ConverseCommand` from `@aws-sdk/client-bedrock-runtime`
- Messages format: `[{ role: 'user'|'assistant', content: [{ text }|{ toolUse }|{ toolResult }] }]`
- Tool call response: `output.message.content` contains `{ toolUse: { toolUseId, name, input } }`
- Tool result message: `{ role: 'user', content: [{ toolResult: { toolUseId, content: [{ text }] } }] }`
- stopReason: `'tool_use'` or `'end_turn'`

### Task D: Update AIProvider Interface (server/services/providers/types.ts)

The interface stays the same — `generateApp()` returns `AsyncIterable<string>`.
But the yielded strings now include JSON events:
- `{"status": "..."}` — status updates
- `{"tool_call": {"name": "...", "input": {...}}}` — tool call started
- `{"tool_result": {"name": "...", "summary": "..."}}` — tool call result
- `{"chunk": "..."}` — final code
- `{"done": true}` — complete

### Task E: Simplify Generate Route (server/routes/generate.ts)

Remove the server-side repair loop. The agent handles everything:

```typescript
router.post(ROUTES.GENERATE, async (context, request, response) => {
  const stream = new Readable({ read() {} });
  
  (async () => {
    const provider = aiService.getProvider();
    // Pass opensearch client to provider for tool execution
    for await (const event of provider.generateApp(prompt, {
      ...context,
      opensearchClient: context.core.opensearch.client.asCurrentUser,
    })) {
      stream.push('data: ' + event + '\n\n');
    }
    stream.push(null);
  })();
  
  return response.ok({ headers: SSE_HEADERS, body: stream });
});
```

### Task F: Update Client AIClient (public/services/ai_client.ts)

Add handling for `tool_call` and `tool_result` events:

```typescript
interface GenerateOptions {
  onStatus?: (message: string) => void;
  onWarning?: (message: string) => void;
  onToolCall?: (name: string, input: any) => void;
  onToolResult?: (name: string, summary: string) => void;
}
```

### Task G: Update Builder Page Activity Log

Show tool calls with icons:
- 🔧 Tool call: name + truncated input
- ✅ Tool result: name + summary
- Different icon per tool type:
  - validate_code → shield icon
  - execute_ppl → database icon
  - get_index_metadata → document icon
  - get_sample_app → code icon
  - get_ppl_reference → book icon
  - get_oui_components → palette icon
  - submit_app → check icon

### Implementation Order

1. **Task B** — Reference data files (ppl_reference.ts, oui_reference.ts) — no deps
2. **Task A** — Tool implementations (agent_tools.ts) — depends on B
3. **Task C** — Bedrock Converse provider — depends on A, B
4. **Task E** — Simplify generate route — depends on C
5. **Task F** — Update client AIClient — depends on E
6. **Task G** — Update activity log UI — depends on F
7. **Task D** — Types update — done alongside C

### Testing

- agent_tools.test.ts — test each tool executor independently
- bedrock_provider.test.ts — mock Converse API, test agent loop with tool calls
- Integration test — full flow with mocked Bedrock returning tool_use responses

### Estimated Scope

- ~7 files changed/created
- ~500-700 lines of new code
- Existing tests updated for new event format
- System prompt shrinks from ~100 lines to ~30 lines (agent fetches refs on demand)
