/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from '../../../../core/server';
import { validateCode } from '../../common/code_validator';
import { PPL_REFERENCE } from './ppl_reference';
import { OUI_REFERENCE } from './oui_reference';

export interface ToolResult {
  content: string;
  summary: string;
}

export async function executeValidateCode(input: { code: string }): Promise<ToolResult> {
  const result = validateCode(input.code);
  if (result.valid) {
    return { content: 'Validation passed. 0 errors.', summary: '\u2705 Valid' };
  }
  const errors = result.errors
    .map((e) => 'Line ' + e.line + ': [' + e.rule + '] ' + e.message)
    .join('\n');
  return {
    content: 'FAILED (' + result.errors.length + ' errors):\n' + errors + '\nFix and re-validate.',
    summary: '\u274c ' + result.errors.length + ' error(s)',
  };
}

export async function executeGetPplReference(): Promise<ToolResult> {
  return { content: PPL_REFERENCE, summary: 'PPL reference loaded' };
}

export async function executeGetOuiComponents(input: { category?: string }): Promise<ToolResult> {
  const cat = input.category || 'overview';
  const ref = OUI_REFERENCE[cat] || OUI_REFERENCE.overview;
  return {
    content: ref + '\n\nCategories: ' + Object.keys(OUI_REFERENCE).join(', '),
    summary: 'OUI ' + cat + ' loaded',
  };
}

export async function executeGetSampleApp(input: { type: string }): Promise<ToolResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SAMPLE_APPS } = require('../../common/sample_apps');
  const app = SAMPLE_APPS.find(
    (a: any) => a.id === input.type || a.title.toLowerCase().indexOf(input.type.toLowerCase()) >= 0
  );
  if (app) {
    const code = app.getCode();
    return {
      content: '// ' + app.title + '\n' + code,
      summary: app.title + ' (' + code.split('\n').length + ' lines)',
    };
  }
  const available = SAMPLE_APPS.map((a: any) => a.id).join(', ');
  return { content: 'Not found. Available: ' + available, summary: 'Not found' };
}

export async function executeGetIndexMetadata(
  input: { index: string },
  client: any,
  logger: Logger
): Promise<ToolResult> {
  try {
    const mapResp = await client.indices.getMapping({ index: input.index });
    const idx = Object.keys(mapResp.body)[0];
    const props = idx ? mapResp.body[idx]?.mappings?.properties || {} : {};

    const fields: string[] = [];
    const walk = (obj: any, prefix: string) => {
      for (const k of Object.keys(obj)) {
        const full = prefix ? prefix + '.' + k : k;
        if (obj[k].properties) walk(obj[k].properties, full);
        else fields.push(full + ' (' + (obj[k].type || 'object') + ')');
      }
    };
    walk(props, '');

    const docs = await client.search({
      index: input.index,
      body: { size: 3, sort: [{ _doc: 'desc' }] },
    });
    const samples = (docs.body.hits?.hits || []).map((h: any) => {
      const d: any = {};
      for (const k of Object.keys(h._source || {})) {
        const v = h._source[k];
        if (typeof v === 'string' && v.length > 80) d[k] = v.substring(0, 80) + '...';
        else if (v && typeof v === 'object' && !Array.isArray(v)) d[k] = '{...}';
        else d[k] = v;
      }
      return d;
    });

    const content =
      'Index: ' +
      input.index +
      ' (' +
      fields.length +
      ' fields)\n\nFields:\n' +
      fields
        .slice(0, 50)
        .map((f) => '  ' + f)
        .join('\n') +
      '\n\nSample docs:\n' +
      JSON.stringify(samples, null, 2);
    return { content, summary: fields.length + ' fields, ' + samples.length + ' docs' };
  } catch (err) {
    logger.warn('get_index_metadata error: ' + err);
    return { content: 'Error: ' + err, summary: 'Error' };
  }
}

export async function executePPL(
  input: { query: string },
  client: any,
  logger: Logger
): Promise<ToolResult> {
  try {
    const resp = await client.transport.request({
      method: 'POST',
      path: '/_plugins/_ppl',
      body: { query: input.query },
    });
    const body = resp.body;
    if (body.datarows && body.schema) {
      const rows = body.datarows.slice(0, 10).map((row: any[]) => {
        const obj: any = {};
        body.schema.forEach((col: any, i: number) => {
          obj[col.name] = row[i];
        });
        return obj;
      });
      return {
        content:
          body.datarows.length +
          ' rows. Schema: ' +
          body.schema.map((s: any) => s.name + ':' + s.type).join(', ') +
          '\nFirst ' +
          rows.length +
          ':\n' +
          JSON.stringify(rows, null, 2),
        summary: body.datarows.length + ' rows, ' + body.schema.length + ' cols',
      };
    }
    return { content: JSON.stringify(body).substring(0, 2000), summary: 'Query executed' };
  } catch (err) {
    logger.warn('execute_ppl error: ' + err);
    return { content: 'PPL error: ' + err, summary: 'Error: ' + String(err).substring(0, 60) };
  }
}

export const TOOL_DEFINITIONS = [
  {
    toolSpec: {
      name: 'validate_code',
      description: 'Validate JS code against security rules. ALWAYS call before submit_app.',
      inputSchema: {
        json: {
          type: 'object',
          properties: { code: { type: 'string', description: 'JS code' } },
          required: ['code'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'execute_ppl',
      description: 'Run a PPL query against OpenSearch, returns real data. Use to test queries.',
      inputSchema: {
        json: {
          type: 'object',
          properties: { query: { type: 'string', description: 'PPL query' } },
          required: ['query'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_index_metadata',
      description: 'Get field mappings and sample docs for an index.',
      inputSchema: {
        json: {
          type: 'object',
          properties: { index: { type: 'string', description: 'Index name/pattern' } },
          required: ['index'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_sample_app',
      description:
        'Get working sample app code. Types: web-logs-explorer, flight-delays-dashboard, ecommerce-overview',
      inputSchema: {
        json: {
          type: 'object',
          properties: { type: { type: 'string', description: 'App type' } },
          required: ['type'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_ppl_reference',
      description: 'Get PPL query language syntax reference.',
      inputSchema: { json: { type: 'object', properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: 'get_oui_components',
      description:
        'Get OUI (aliased as @elastic/eui) component examples. Categories: layout, data-display, forms, charts, navigation, feedback',
      inputSchema: {
        json: {
          type: 'object',
          properties: { category: { type: 'string', description: 'Category' } },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'submit_app',
      description: 'Submit final validated code. ONLY after validate_code returns 0 errors.',
      inputSchema: {
        json: {
          type: 'object',
          properties: { code: { type: 'string', description: 'Final code' } },
          required: ['code'],
        },
      },
    },
  },
];
