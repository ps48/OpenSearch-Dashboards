# OSD Apps Builder — Low-Level Design

**Parent:** [osd-apps-hld.md](./osd-apps-hld.md)  
**Plugin Path:** `src/plugins/osd_apps_builder/`

This document specifies exact file contents, function signatures, import paths, and test cases for all 9 Phase 1 tasks. It covers only what the HLD does not — implementation-level detail.

---

## Table of Contents

1. [Task 1: Plugin Scaffold and Saved Object Type](#task-1-plugin-scaffold-and-saved-object-type)
2. [Task 2: Apps Listing Page with Navigation](#task-2-apps-listing-page-with-navigation)
3. [Task 3: AI Proxy Service with Bedrock Provider](#task-3-ai-proxy-service-with-bedrock-provider)
4. [Task 4: Code Validation and Sanitization Service](#task-4-code-validation-and-sanitization-service)
5. [Task 5: In-Process App Renderer](#task-5-in-process-app-renderer)
6. [Task 6: App Builder UI](#task-6-app-builder-ui)
7. [Task 7: App Save, Load, and Data Source Integration](#task-7-app-save-load-and-data-source-integration)
8. [Task 8: App Viewer](#task-8-app-viewer)
9. [Task 9: Undo/Redo and Workspace Scoping](#task-9-undoredo-and-workspace-scoping)

---

## Task 1: Plugin Scaffold and Saved Object Type

### Files Created

```
src/plugins/osd_apps_builder/
├── opensearch_dashboards.json
├── common/
│   ├── types.ts
│   └── constants.ts
├── server/
│   ├── index.ts
│   ├── plugin.ts
│   ├── config.ts
│   ├── capabilities_provider.ts
│   └── saved_objects/
│       ├── osd_app.ts
│       └── index.ts
├── public/
│   ├── index.ts
│   └── plugin.ts
└── server/saved_objects/
    └── osd_app.test.ts
    └── ../plugin.test.ts
```

### opensearch_dashboards.json

```json
{
  "id": "osdAppsBuilder",
  "version": "opensearchDashboards",
  "server": true,
  "ui": true,
  "requiredPlugins": [
    "data",
    "navigation",
    "savedObjects",
    "savedObjectsManagement",
    "opensearchDashboardsReact"
  ],
  "optionalPlugins": [
    "dataSource",
    "dataSourceManagement",
    "queryEnhancements",
    "workspace"
  ],
  "requiredBundles": ["dataSourceManagement"]
}
```

### common/constants.ts

```typescript
export const PLUGIN_ID = 'osdAppsBuilder';
export const PLUGIN_NAME = 'OSD Apps';
export const SAVED_OBJECT_TYPE = 'osd-app';

export const APP_ID = 'osd-apps';
export const BUILDER_APP_ID = 'osd-apps-builder';

export const API_BASE = '/api/osd-apps';
export const ROUTES = {
  GENERATE: `${API_BASE}/generate`,
  REFINE: `${API_BASE}/refine`,
  VALIDATE: `${API_BASE}/validate`,
} as const;
```

### common/types.ts

```typescript
export interface DataSourceRef {
  id: string;
  type: 'DATA_SOURCE' | 'PROMETHEUS';
  title: string;
}

export interface PromptEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface OsdAppAttributes {
  title: string;
  description: string;
  author: string;
  version: number;
  sourceCode: string;
  dataSourceRefs: string;    // JSON-serialized DataSourceRef[]
  promptHistory: string;     // JSON-serialized PromptEntry[]
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

Note: `dataSourceRefs` and `promptHistory` are stored as JSON strings in the saved object (same pattern as `panelsJSON` in dashboard). The typed interfaces are for client-side use after parsing.

### server/config.ts

```typescript
import { schema, TypeOf } from '@osd/config-schema';

export const configSchema = schema.object({
  enabled: schema.boolean({ defaultValue: false }),
  provider: schema.string({ defaultValue: 'bedrock' }),
  bedrock: schema.object({
    region: schema.string({ defaultValue: 'us-east-1' }),
    modelId: schema.string({ defaultValue: 'anthropic.claude-3-sonnet-20240229-v1:0' }),
  }),
});

export type OsdAppsBuilderConfigType = TypeOf<typeof configSchema>;
```

### server/saved_objects/osd_app.ts

Import: `SavedObjectsType` from `'opensearch-dashboards/server'`

Key details:
- `name`: value of `SAVED_OBJECT_TYPE` from common/constants
- `namespaceType: 'single'`
- `management.icon`: `'apps'`
- `management.getInAppUrl`: returns `{ path: '/app/osd-apps/view/${obj.id}', uiCapabilitiesPath: 'osdApps.show' }`
- `management.getEditUrl`: returns `/management/opensearch-dashboards/objects/savedOsdApps/${obj.id}`
- `mappings.properties`: title (text), description (text), author (keyword), version (integer), sourceCode (text, index:false), dataSourceRefs (text, index:false), promptHistory (text, index:false), tags (keyword), createdAt (date), updatedAt (date)
- `migrations: {}`

### server/saved_objects/index.ts

Re-exports `osdAppSavedObjectType` from `'./osd_app'`.

### server/capabilities_provider.ts

```typescript
export const capabilitiesProvider = () => ({
  osdApps: {
    show: true,
    createNew: true,
    save: true,
  },
});
```

### server/plugin.ts

- Class: `OsdAppsBuilderPlugin implements Plugin<{}, {}>`
- Constructor: takes `PluginInitializerContext`, creates logger via `initializerContext.logger.get()`
- `setup(core: CoreSetup)`:
  1. `core.savedObjects.registerType(osdAppSavedObjectType)`
  2. `core.capabilities.registerProvider(capabilitiesProvider)`
  3. Returns `{}`
- `start(core: CoreStart)`: Returns `{}`
- `stop()`: empty

### server/index.ts

```typescript
import { PluginConfigDescriptor, PluginInitializerContext } from '../../../core/server';
import { OsdAppsBuilderPlugin } from './plugin';
import { configSchema, OsdAppsBuilderConfigType } from './config';

export const config: PluginConfigDescriptor<OsdAppsBuilderConfigType> = {
  schema: configSchema,
  exposeToBrowser: {
    enabled: true,
  },
};

export function plugin(initializerContext: PluginInitializerContext) {
  return new OsdAppsBuilderPlugin(initializerContext);
}
```

### public/plugin.ts

- Class: `OsdAppsBuilderPublicPlugin implements Plugin<{}, {}>`
- `setup(core: CoreSetup)`:
  1. Register app `APP_ID` ('osd-apps') — title 'Apps', category `DEFAULT_APP_CATEGORIES.opensearchDashboards`, mount renders placeholder `<div>Apps listing — coming soon</div>`
  2. Register app `BUILDER_APP_ID` ('osd-apps-builder') — title 'App Builder', mount renders placeholder
  3. Add nav links to `DEFAULT_NAV_GROUPS.essentials` and `DEFAULT_NAV_GROUPS.all` for `APP_ID` with category `DEFAULT_APP_CATEGORIES.opensearchDashboards`
  4. Returns `{}`
- `start()`: Returns `{}`

Mount pattern (from data_importer):
```typescript
async mount(params: AppMountParameters) {
  const { renderApp } = await import('./application');
  const [coreStart] = await core.getStartServices();
  return renderApp(coreStart, params);
}
```

For Task 1, the mount function renders a simple React element directly (no separate application file yet):
```typescript
async mount(params: AppMountParameters) {
  const { render, unmountComponentAtNode } = await import('react-dom');
  const { createElement } = await import('react');
  render(createElement('div', null, 'Apps listing — coming soon'), params.element);
  return () => unmountComponentAtNode(params.element);
}
```

### public/index.ts

```typescript
import { PluginInitializerContext } from '../../../core/public';
import { OsdAppsBuilderPublicPlugin } from './plugin';

export function plugin(initializerContext: PluginInitializerContext) {
  return new OsdAppsBuilderPublicPlugin(initializerContext);
}
```

### Tests

**server/saved_objects/osd_app.test.ts:**
- Test: `osdAppSavedObjectType` has `name` equal to `'osd-app'`
- Test: `namespaceType` is `'single'`
- Test: `management.importableAndExportable` is `true`
- Test: `management.getTitle()` returns `obj.attributes.title`
- Test: `management.getInAppUrl()` returns path containing the object id
- Test: `mappings.properties` contains all expected fields: title, description, author, version, sourceCode, dataSourceRefs, promptHistory, tags, createdAt, updatedAt
- Test: `mappings.properties.sourceCode.index` is `false`

**server/plugin.test.ts:**
- Mock `CoreSetup` with `savedObjects.registerType` and `capabilities.registerProvider` as jest.fn()
- Test: `setup()` calls `core.savedObjects.registerType` with the osd-app type
- Test: `setup()` calls `core.capabilities.registerProvider` with the capabilities provider

---

## Task 2: Apps Listing Page with Navigation

### Files Created/Modified

```
public/
├── application.tsx                    # renderApp entry point
├── applications/
│   ├── apps_listing/
│   │   ├── apps_listing_page.tsx      # Main listing component
│   │   └── apps_listing_page.test.tsx
│   └── app_builder/
│       └── app_builder_page.tsx       # Placeholder for now
└── plugin.ts                          # Updated: real mount functions
```

### public/application.tsx

Entry point for the listing app. Pattern from data_importer:

```typescript
export const renderApp = (
  coreStart: CoreStart,
  params: AppMountParameters
): (() => void) => {
  render(
    <OpenSearchDashboardsContextProvider services={{ ...coreStart }}>
      <AppsListingPage
        savedObjectsClient={coreStart.savedObjects.client}
        notifications={coreStart.notifications}
      />
    </OpenSearchDashboardsContextProvider>,
    params.element
  );
  return () => unmountComponentAtNode(params.element);
};
```

### public/applications/apps_listing/apps_listing_page.tsx

Props:
```typescript
interface AppsListingPageProps {
  savedObjectsClient: SavedObjectsClientContract;
  notifications: NotificationsStart;
}
```

Implementation:
- `useEffect` on mount: call `savedObjectsClient.find({ type: SAVED_OBJECT_TYPE, perPage: 1000 })` to load all apps
- Render `EuiInMemoryTable` with columns: title (link to viewer), description, tags (badges), updatedAt (relative time)
- `EuiInMemoryTable` search box config: `{ box: { incremental: true }, filters: [{ type: 'field_value_selection', field: 'tags', name: 'Tags' }] }`
- Empty state: `EuiEmptyPrompt` with "Create your first app" button linking to builder
- "Create app" button in top-right linking to `/app/osd-apps-builder`
- Title row click navigates to `/app/osd-apps/view/${id}` via `core.application.navigateToApp()`

### public/plugin.ts (updated)

Update mount functions to use `renderApp` for listing and a placeholder for builder. Add `core.chrome.setBreadcrumbs` in mount.

### Tests

**apps_listing_page.test.tsx:**
- Test: renders empty state when no apps exist
- Test: renders table with apps when apps are loaded
- Test: search filters apps by title
- Test: "Create app" button is present

---

## Task 3: AI Proxy Service with Bedrock Provider

### Files Created

```
server/
├── routes/
│   ├── index.ts
│   ├── generate.ts
│   └── refine.ts
├── services/
│   ├── ai_proxy_service.ts
│   └── providers/
│       ├── types.ts
│       ├── bedrock_provider.ts
│       ├── openai_provider.ts
│       └── self_hosted_provider.ts
└── plugin.ts                          # Updated: create router, register routes
```

### server/services/providers/types.ts

```typescript
export interface AppGenerationContext {
  indexMetadata?: Array<{ title: string; fields: Array<{ name: string; type: string }> }>;
  dataSourceRefs?: Array<{ id: string; type: string; title: string }>;
  existingCode?: string;
  componentLibrary: 'oui+echarts';
}

export interface AIProvider {
  id: string;
  generateApp(prompt: string, context: AppGenerationContext): AsyncIterable<string>;
  refineApp(prompt: string, existingCode: string, context: AppGenerationContext): AsyncIterable<string>;
}
```

### server/services/providers/bedrock_provider.ts

- Class: `BedrockProvider implements AIProvider`
- Constructor: takes `region: string`, `modelId: string`, `logger: Logger`
- Creates `BedrockRuntimeClient` from `@aws-sdk/client-bedrock-runtime`
- `generateApp()`: builds system prompt instructing model to generate React/OUI+ECharts code, calls `InvokeModelWithResponseStreamCommand`, yields chunks
- `refineApp()`: same but includes existing code in the prompt
- System prompt template stored as a constant, includes: allowed imports, OsdAppApi interface description, code style rules

### server/services/providers/openai_provider.ts / self_hosted_provider.ts

Stubs that throw: `new Error('OpenAI provider is not configured. Set osdAppsBuilder.provider in opensearch_dashboards.yml')`

### server/services/ai_proxy_service.ts

```typescript
export class AIProxyService {
  private provider: AIProvider;

  constructor(config: OsdAppsBuilderConfigType, logger: Logger) {
    switch (config.provider) {
      case 'bedrock':
        this.provider = new BedrockProvider(config.bedrock.region, config.bedrock.modelId, logger);
        break;
      case 'openai':
        this.provider = new OpenAIProvider();
        break;
      default:
        this.provider = new SelfHostedProvider();
    }
  }

  getProvider(): AIProvider { return this.provider; }
}
```

### server/routes/generate.ts

```typescript
export function registerGenerateRoute(router: IRouter, aiService: AIProxyService, logger: Logger) {
  router.post(
    { path: ROUTES.GENERATE, validate: { body: schema.object({
      prompt: schema.string(),
      context: schema.maybe(schema.object({
        indexMetadata: schema.maybe(schema.arrayOf(schema.any())),
        dataSourceRefs: schema.maybe(schema.arrayOf(schema.any())),
      })),
    })}},
    async (context, request, response) => {
      // Stream response using response.ok with custom body
      // Set headers: 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'
      // Iterate over provider.generateApp() and write chunks
    }
  );
}
```

### server/routes/refine.ts

Same pattern as generate but includes `existingCode: schema.string()` in body validation and calls `provider.refineApp()`.

### server/plugin.ts (updated)

In `setup()`:
1. Read config via `this.config$.pipe(first()).toPromise()`
2. Create `AIProxyService` instance
3. Create router via `core.http.createRouter()`
4. Call `registerGenerateRoute(router, aiService, logger)` and `registerRefineRoute(...)`

### Tests

**server/services/ai_proxy_service.test.ts:**
- Test: creates BedrockProvider when config.provider is 'bedrock'
- Test: throws when using unconfigured provider (openai/self-hosted)

**server/routes/generate.test.ts:**
- Test: returns 400 when prompt is missing
- Test: returns streaming response with correct content-type headers
- Test: streams chunks from provider (mock provider yields 3 chunks)

---

## Task 4: Code Validation and Sanitization Service

### Files Created

```
server/
└── services/
    ├── code_validator.ts
    └── code_validator.test.ts
server/routes/
    └── validate.ts
public/
└── services/
    └── client_code_validator.ts
```

### server/services/code_validator.ts

```typescript
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  rule: string;
}

export function validateCode(code: string): ValidationResult
```

Implementation:
1. Parse code with `@babel/parser` (already in OSD deps) using `parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })`
2. Traverse AST with `@babel/traverse`
3. Visitor checks:

| AST Node | Check | Rule ID |
|----------|-------|---------|
| `CallExpression` where callee is `eval` or `Function` | Reject | `no-eval` |
| `MemberExpression` accessing `document.cookie`, `document.domain` | Reject | `no-document-access` |
| `MemberExpression` accessing `localStorage`, `sessionStorage` | Reject | `no-storage-access` |
| `CallExpression` for `fetch`, `XMLHttpRequest`, `WebSocket` | Reject | `no-network-access` |
| `AssignmentExpression` to `innerHTML`, `outerHTML` | Reject | `no-inner-html` |
| `JSXAttribute` named `dangerouslySetInnerHTML` | Reject | `no-dangerous-html` |
| `AssignmentExpression` to `window.location` | Reject | `no-navigation` |
| `ImportDeclaration` with source not in allowlist | Reject | `no-unauthorized-import` |
| `CallExpression` for dynamic `import()` | Reject | `no-dynamic-import` |

Allowed import sources: `'react'`, `'@elastic/eui'`, `'echarts'`, `'echarts-for-react'`, `'@osd-apps/api'`

4. Return `{ valid: true, errors: [] }` or `{ valid: false, errors: [...] }`

### server/routes/validate.ts

```typescript
export function registerValidateRoute(router: IRouter) {
  router.post(
    { path: ROUTES.VALIDATE, validate: { body: schema.object({ code: schema.string() }) } },
    async (context, request, response) => {
      const result = validateCode(request.body.code);
      return response.ok({ body: result });
    }
  );
}
```

### public/services/client_code_validator.ts

Re-exports the same `validateCode` function for client-side defense-in-depth. Uses the same Babel parser (available client-side via OSD's bundled deps).

### Tests

**server/services/code_validator.test.ts:**

Positive cases (should pass):
- Valid React/OUI component: `import { EuiButton } from '@elastic/eui'; export default () => <EuiButton>Click</EuiButton>;`
- ECharts usage: `import ReactECharts from 'echarts-for-react';`
- Using `@osd-apps/api`: `import { search } from '@osd-apps/api';`

Negative cases (should fail with specific rule):
- `eval('alert(1)')` → `no-eval`
- `document.cookie` → `no-document-access`
- `localStorage.getItem('x')` → `no-storage-access`
- `fetch('https://evil.com')` → `no-network-access`
- `el.innerHTML = '<script>'` → `no-inner-html`
- `<div dangerouslySetInnerHTML={{__html: x}} />` → `no-dangerous-html`
- `window.location = 'https://evil.com'` → `no-navigation`
- `import axios from 'axios'` → `no-unauthorized-import`
- `import('lodash')` → `no-dynamic-import`

---

## Task 5: In-Process App Renderer

### Files Created

```
public/
└── services/
    ├── app_renderer.ts
    ├── app_renderer.test.ts
    ├── scoped_api.ts
    ├── scoped_api.test.ts
    └── code_transpiler.ts
public/
└── components/
    ├── live_preview.tsx
    ├── live_preview.test.tsx
    └── app_error_boundary.tsx
```

### public/services/code_transpiler.ts

```typescript
export function transpileCode(code: string): string
```

Uses `@babel/standalone` (lazy-loaded only when builder is opened):
- Transform JSX → JS via `Babel.transform(code, { presets: ['react', 'typescript'], filename: 'app.tsx' })`
- Rewrite imports: replace `import { X } from '@elastic/eui'` with references to a pre-loaded module registry
- Return executable JS string

### public/services/scoped_api.ts

```typescript
export interface OsdAppApi {
  search(params: {
    query: string;
    language: 'PPL' | 'PromQL';
    dataset?: { dataSource?: { id: string; type: string }; title: string; type: string };
  }): Promise<any>;
  theme: { isDarkMode: boolean };
  timeRange: { from: string; to: string };
  navigateToApp(appId: string, options?: { path?: string }): void;
}

export function createScopedApi(deps: {
  data: DataPublicPluginStart;
  core: CoreStart;
}): OsdAppApi
```

Implementation:
- `search()`: delegates to `deps.data.search.search()` with the provided query/language/dataset
- `theme`: reads `deps.core.uiSettings.get('theme:darkMode')`
- `timeRange`: reads from `deps.data.query.timefilter.timefilter.getTime()`
- `navigateToApp()`: delegates to `deps.core.application.navigateToApp()`

### public/services/app_renderer.ts

```typescript
export interface RenderResult {
  component: React.ComponentType | null;
  error: string | null;
}

export function renderAppCode(
  code: string,
  scopedApi: OsdAppApi,
  moduleRegistry: Record<string, any>
): RenderResult
```

Pipeline:
1. Client-side validate via `validateCode(code)` — if invalid, return `{ component: null, error }`
2. Transpile via `transpileCode(code)`
3. Create module scope: `{ react: React, '@elastic/eui': euiModules, 'echarts-for-react': echarts, '@osd-apps/api': scopedApi }`
4. Execute transpiled code in a `new Function()` wrapper that receives the module scope (this is safe because the code has already been AST-validated — the validator blocks `eval`/`Function` in *generated* code, but the renderer itself uses `Function` as the execution mechanism)
5. Extract the default export as the component
6. Return `{ component, error: null }`

### public/components/app_error_boundary.tsx

```typescript
interface Props { children: React.ReactNode; fallback?: React.ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class AppErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(error: Error): State;
  render(): renders children or fallback EuiEmptyPrompt with error message
}
```

### public/components/live_preview.tsx

```typescript
interface LivePreviewProps {
  code: string;
  scopedApi: OsdAppApi;
}
```

Implementation:
- Calls `renderAppCode(code, scopedApi, moduleRegistry)` when `code` changes (debounced 300ms)
- Wraps result in `<AppErrorBoundary>` and `<EuiProvider>`
- Shows `EuiLoadingSpinner` during transpilation
- Shows `EuiCallOut` with error details if rendering fails
- Timeout: uses `setTimeout(5000)` during first render — if component hasn't rendered, shows timeout error

### Tests

**app_renderer.test.ts:**
- Test: renders a simple component `export default () => <div>Hello</div>`
- Test: returns error for code that fails validation
- Test: returns error for code with syntax errors

**scoped_api.test.ts:**
- Test: `search()` delegates to `data.search.search()` with correct params
- Test: `theme.isDarkMode` reads from uiSettings
- Test: `timeRange` reads from timefilter

**live_preview.test.tsx:**
- Test: renders component from valid code
- Test: shows error boundary fallback for broken component
- Test: shows validation error for unsafe code

---

## Task 6: App Builder UI

### Files Created

```
public/
├── applications/
│   └── app_builder/
│       ├── app_builder_page.tsx
│       ├── app_builder_page.test.tsx
│       └── components/
│           ├── prompt_input.tsx
│           ├── prompt_input.test.tsx
│           ├── chat_history.tsx
│           ├── data_source_picker.tsx
│           └── prompt_suggestions.tsx
└── services/
    └── ai_client.ts
```

### public/services/ai_client.ts

```typescript
export class AIClient {
  constructor(private http: HttpStart) {}

  async *generate(prompt: string, context?: object): AsyncGenerator<string> {
    // POST to ROUTES.GENERATE with fetch() using ReadableStream
    // Parse SSE chunks, yield each code fragment
  }

  async *refine(prompt: string, existingCode: string, context?: object): AsyncGenerator<string> {
    // POST to ROUTES.REFINE, same streaming pattern
  }
}
```

Uses `fetch()` directly (not `http.post`) to support streaming via `response.body.getReader()`. This is an internal call to the OSD server, not an external request.

### public/applications/app_builder/components/prompt_input.tsx

```typescript
interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  isGenerating: boolean;
}
```

- `EuiTextArea` with `EuiButton` (send)
- Submit on Enter (without Shift) or button click
- Disabled during generation (`isGenerating`)
- `data-test-subj="osdAppsPromptInput"` and `data-test-subj="osdAppsPromptSubmit"`

### public/applications/app_builder/components/chat_history.tsx

```typescript
interface ChatHistoryProps {
  entries: PromptEntry[];
}
```

- Scrollable list of prompt/response pairs
- User messages right-aligned, assistant messages left-aligned
- Uses `EuiComment` or simple styled divs
- Auto-scrolls to bottom on new entry

### public/applications/app_builder/components/data_source_picker.tsx

```typescript
interface DataSourcePickerProps {
  onSelect: (refs: DataSourceRef[]) => void;
  selectedRefs: DataSourceRef[];
}
```

- Uses `savedObjectsClient.find({ type: 'index-pattern' })` to list available indices
- If `dataSource` plugin is available, also lists configured data sources
- `EuiComboBox` for multi-select
- Selected refs are passed as context to AI generation

### public/applications/app_builder/components/prompt_suggestions.tsx

- Shown when chat history is empty
- Hardcoded list of example prompts:
  - "Build a real-time log viewer for nginx-logs-* with error highlighting"
  - "Create a metrics dashboard with latency and throughput charts"
  - "Build a form to search and filter documents in my-index"
- Each suggestion is an `EuiCard` that populates the prompt input on click

### public/applications/app_builder/app_builder_page.tsx

```typescript
interface AppBuilderPageProps {
  core: CoreStart;
  data: DataPublicPluginStart;
  savedObjectsClient: SavedObjectsClientContract;
  notifications: NotificationsStart;
  appId?: string;  // If editing an existing app
}
```

Layout: `EuiResizableContainer` with two panels (horizontal split):
- **Left panel (40%):** PromptSuggestions (when empty) → PromptInput + ChatHistory + DataSourcePicker
- **Right panel (60%):** LivePreview

State management:
```typescript
const [code, setCode] = useState('');
const [promptHistory, setPromptHistory] = useState<PromptEntry[]>([]);
const [isGenerating, setIsGenerating] = useState(false);
const [dataSourceRefs, setDataSourceRefs] = useState<DataSourceRef[]>([]);
```

Generation flow:
1. User submits prompt → add to `promptHistory` as `{ role: 'user', content: prompt }`
2. Set `isGenerating = true`
3. Call `aiClient.generate()` (or `.refine()` if code exists), accumulate streamed chunks into `code`
4. On complete: add `{ role: 'assistant', content: code }` to history, set `isGenerating = false`
5. `LivePreview` re-renders with new `code`

### Tests

**prompt_input.test.tsx:**
- Test: calls onSubmit when button clicked
- Test: calls onSubmit on Enter key
- Test: button disabled when isGenerating is true

**app_builder_page.test.tsx:**
- Test: renders prompt suggestions when history is empty
- Test: renders chat history and preview pane
- Test: submitting a prompt triggers generation (mock AIClient)

---

## Task 7: App Save, Load, and Data Source Integration

### Files Created/Modified

```
public/
├── applications/
│   └── app_builder/
│       ├── app_builder_page.tsx       # Updated: save/load logic
│       └── components/
│           └── save_app_modal.tsx
└── services/
    └── app_saved_object_client.ts
```

### public/services/app_saved_object_client.ts

```typescript
export class AppSavedObjectClient {
  constructor(private savedObjectsClient: SavedObjectsClientContract) {}

  async save(attrs: Partial<OsdAppAttributes>, id?: string): Promise<string> {
    // If id exists: update. Otherwise: create.
    // Sets updatedAt to now, createdAt on create, version increment on update
    // Returns saved object id
  }

  async load(id: string): Promise<OsdAppAttributes> {
    // savedObjectsClient.get(SAVED_OBJECT_TYPE, id)
    // Returns attributes
  }

  async list(): Promise<Array<{ id: string; attributes: OsdAppAttributes }>> {
    // savedObjectsClient.find({ type: SAVED_OBJECT_TYPE })
  }

  async remove(id: string): Promise<void> {
    // savedObjectsClient.delete(SAVED_OBJECT_TYPE, id)
  }
}
```

### public/applications/app_builder/components/save_app_modal.tsx

```typescript
interface SaveAppModalProps {
  onSave: (title: string, description: string, tags: string[]) => void;
  onClose: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialTags?: string[];
}
```

- Uses `EuiModal` with `EuiForm`
- Fields: title (required), description (optional), tags (`EuiComboBox` with `onCreateOption` for new tags)
- Save button calls `onSave`, close button calls `onClose`
- `data-test-subj="osdAppsSaveModal"`

### app_builder_page.tsx updates

- Add "Save" button in top bar
- On save: open `SaveAppModal`, on confirm call `appSavedObjectClient.save()` with current code, prompt history, data source refs
- If `appId` prop is set: load existing app on mount via `appSavedObjectClient.load(appId)`, populate code, history, refs
- After save: show success toast via `notifications.toasts.addSuccess()`
- URL updates to include `?id=<savedObjectId>` after first save

### Data query integration

The `ScopedApi.search()` method (from Task 5) already delegates to `data.search`. In this task, we wire it to the generated app's context:

- `DataSourcePicker` selections are passed as `context.dataSourceRefs` to the AI
- The AI generates code that calls `api.search({ query: '...', language: 'PPL', dataset: { dataSource: { id: 'ds-1', type: 'DATA_SOURCE' }, title: 'nginx-logs-*', type: 'INDEX_PATTERN' } })`
- The `ScopedApi` routes this through `data.search` which uses `query_enhancements` for PPL/PromQL

### Tests

**app_saved_object_client.test.ts:**
- Test: `save()` creates new saved object when no id
- Test: `save()` updates existing saved object when id provided
- Test: `load()` returns attributes for valid id
- Test: `list()` returns all osd-app saved objects

**save_app_modal.test.tsx:**
- Test: renders form fields
- Test: calls onSave with title, description, tags
- Test: validates title is required

---

## Task 8: App Viewer

### Files Created

```
public/
├── applications/
│   └── app_viewer/
│       ├── app_viewer_page.tsx
│       └── app_viewer_page.test.tsx
└── application_viewer.tsx             # renderViewerApp entry point
```

### public/application_viewer.tsx

Entry point for the viewer app. Parses the app ID from the URL path:

```typescript
export const renderViewerApp = (
  coreStart: CoreStart,
  depsStart: AppPluginStartDependencies,
  params: AppMountParameters
): (() => void) => {
  // Extract app ID from params.history.location.pathname: /view/<id>
  const appId = params.history.location.pathname.replace('/view/', '');

  render(
    <OpenSearchDashboardsContextProvider services={{ ...coreStart }}>
      <AppViewerPage
        appId={appId}
        core={coreStart}
        data={depsStart.data}
        navigation={depsStart.navigation}
      />
    </OpenSearchDashboardsContextProvider>,
    params.element
  );
  return () => unmountComponentAtNode(params.element);
};
```

### public/applications/app_viewer/app_viewer_page.tsx

```typescript
interface AppViewerPageProps {
  appId: string;
  core: CoreStart;
  data: DataPublicPluginStart;
  navigation: NavigationStart;
}
```

Implementation:
1. On mount: load app via `savedObjectsClient.get(SAVED_OBJECT_TYPE, appId)`
2. Set breadcrumbs: `core.chrome.setBreadcrumbs([{ text: 'Apps', href: '/app/osd-apps' }, { text: app.title }])`
3. Render top nav with optional time picker using `navigation.ui.TopNavMenu`:
   ```typescript
   <TopNavMenu
     appName={APP_ID}
     showDatePicker={true}
     showSearchBar={false}
   />
   ```
4. Render `<LivePreview code={app.sourceCode} scopedApi={scopedApi} />` below the top nav
5. Action buttons in top nav:
   - **Edit**: navigates to `/app/osd-apps-builder?id=${appId}`
   - **Share**: copies deep link URL to clipboard, shows toast
6. Error states:
   - App not found: `EuiEmptyPrompt` with "App not found" message
   - Permission denied: `EuiEmptyPrompt` with "You don't have permission to view this app"

### public/plugin.ts (updated)

Update the `APP_ID` mount to handle routing:
- `/` → listing page
- `/view/:id` → viewer page

Use `react-router-dom` (already in OSD) with `<Switch>` and `<Route>`:
```typescript
async mount(params: AppMountParameters) {
  const { renderApp } = await import('./application');
  const [coreStart, depsStart] = await core.getStartServices();
  return renderApp(coreStart, depsStart, params);
}
```

The `application.tsx` renders a router:
```typescript
<Router history={params.history}>
  <Switch>
    <Route exact path="/" component={AppsListingPage} />
    <Route path="/view/:id" component={AppViewerPage} />
  </Switch>
</Router>
```

### Tests

**app_viewer_page.test.tsx:**
- Test: loads and renders app by ID
- Test: sets breadcrumbs with app title
- Test: shows "App not found" for invalid ID
- Test: Edit button navigates to builder with app ID
- Test: time picker is rendered

---

## Task 9: Undo/Redo and Workspace Scoping

### Files Created

```
public/
└── services/
    ├── use_app_state.ts
    └── use_app_state.test.ts
```

### public/services/use_app_state.ts

```typescript
interface AppState {
  code: string;
  promptHistory: PromptEntry[];
  dataSourceRefs: DataSourceRef[];
}

interface UseAppStateReturn {
  state: AppState;
  setState: (newState: Partial<AppState>) => void;
  pushState: (newState: Partial<AppState>) => void;  // Pushes to undo stack
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const MAX_HISTORY = 20;

export function useAppState(initialState?: Partial<AppState>): UseAppStateReturn
```

Implementation:
- `undoStack: AppState[]` (max `MAX_HISTORY` entries)
- `redoStack: AppState[]` (cleared on new `pushState`)
- `pushState()`: pushes current state to undoStack (trim if > MAX_HISTORY), clears redoStack, sets new state
- `undo()`: pops from undoStack, pushes current to redoStack, sets popped state
- `redo()`: pops from redoStack, pushes current to undoStack, sets popped state
- `canUndo`: `undoStack.length > 0`
- `canRedo`: `redoStack.length > 0`

### app_builder_page.tsx updates

- Replace individual `useState` calls with `useAppState()`
- Each AI generation completion calls `pushState({ code: newCode, promptHistory: newHistory })`
- Add undo/redo buttons in toolbar: `EuiButtonIcon` with `arrowLeft`/`arrowRight` icons
- Register keyboard shortcuts via `useEffect`:
  ```typescript
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);
  ```

### Workspace scoping

No additional code needed. The `osd-app` saved object type uses `namespaceType: 'single'` (set in Task 1), which means:
- In workspace-aware deployments, the saved objects service automatically scopes CRUD operations to the active workspace
- The listing page's `savedObjectsClient.find()` only returns apps in the current workspace
- No workspace-specific filtering code is required in the plugin

This is the same mechanism used by the `dashboard` saved object type.

### Tests

**use_app_state.test.ts:**
- Test: initial state is set correctly
- Test: `pushState()` updates current state
- Test: `undo()` restores previous state
- Test: `redo()` restores undone state
- Test: `undo()` after multiple pushes walks back through history
- Test: `pushState()` after undo clears redo stack
- Test: history is capped at MAX_HISTORY (20)
- Test: `canUndo` is false when stack is empty
- Test: `canRedo` is false when stack is empty

---

## Dependency Summary

### npm packages (already in OSD)

| Package | Used In | Purpose |
|---------|---------|---------|
| `@babel/parser` | code_validator (server + client) | Parse generated code into AST |
| `@babel/traverse` | code_validator (server) | Walk AST to check for blocked patterns |
| `@babel/standalone` | code_transpiler (client, lazy-loaded) | Transpile JSX → JS in browser |
| `react`, `react-dom` | public/* | UI rendering |
| `@elastic/eui` | public/* | OUI component library |
| `react-router-dom` | application.tsx | Client-side routing |

### npm packages (new — need to verify availability)

| Package | Used In | Purpose |
|---------|---------|---------|
| `@aws-sdk/client-bedrock-runtime` | bedrock_provider (server) | Bedrock API calls |

Check: `ls node_modules/@aws-sdk/client-bedrock-runtime` — if not present, add to `package.json` dependencies.

### OSD plugin dependencies

| Plugin | Required/Optional | Used For |
|--------|-------------------|----------|
| `data` | Required | `data.search` for queries, timefilter, query bar |
| `navigation` | Required | `TopNavMenu` component |
| `savedObjects` | Required | `SavedObjectLoader` |
| `savedObjectsManagement` | Required | Saved objects management UI integration |
| `opensearchDashboardsReact` | Required | `OpenSearchDashboardsContextProvider` |
| `dataSource` | Optional | Multi-datasource support |
| `dataSourceManagement` | Optional (requiredBundle) | Data source picker UI components |
| `queryEnhancements` | Optional | PPL and PromQL query support |
| `workspace` | Optional | Workspace-aware nav and scoping |
