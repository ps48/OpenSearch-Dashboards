/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { CORE_FIELDS, classifyDataIssue, isIndexMissing } from './eval_data_issue';
import { buildDataCheckQuery, buildNullGroupsCheckQuery } from './ppl_queries';

/** The messages PPL and the data source client return (OpenSearch 3.9, OSD data sources). */
describe('classifyDataIssue', () => {
  it('no index matches the pattern', () => {
    expect(classifyDataIssue('no such index [tmp-r4-nomatch*]')).toEqual({
      kind: 'index-missing',
    });
    expect(classifyDataIssue({ body: { type: 'IndexNotFoundException' } })?.kind).toBe(
      'index-missing'
    );
    expect(isIndexMissing('index_not_found_exception')).toBe(true);
    expect(isIndexMissing('Field [x] not found.')).toBe(false);
  });

  it('a field the queries name is not mapped, with its name', () => {
    expect(classifyDataIssue('Field [attributes.error.type] not found.')).toEqual({
      kind: 'field-missing',
      field: 'attributes.error.type',
    });
    expect(
      classifyDataIssue(
        "can't resolve Symbol(namespace=FIELD_NAME, name=attributes.gen_ai.evaluation.score.label) in type env"
      )
    ).toEqual({ kind: 'field-missing', field: 'attributes.gen_ai.evaluation.score.label' });
    // A response body with the structured reason.
    expect(
      classifyDataIssue({
        body: { error: { code: 'FIELD_NOT_FOUND', context: { requested_field: 'attributes.x' } } },
      })
    ).toEqual({ kind: 'field-missing', field: 'attributes.x' });
    expect(classifyDataIssue('FIELD_NOT_FOUND')).toEqual({ kind: 'field-missing' });
  });

  it('no eventName or @timestamp in the mapping: the indices hold no results', () => {
    expect(classifyDataIssue('Field [eventName] not found.')).toEqual({ kind: 'no-results' });
    expect(classifyDataIssue('Field [@timestamp] not found.')).toEqual({ kind: 'no-results' });
  });

  it('the data source is gone or does not answer', () => {
    expect(classifyDataIssue('Data Source Error: No Living connections')?.kind).toBe('data-source');
    expect(
      classifyDataIssue('Data Source Error: Saved object [data-source/abc] not found')?.kind
    ).toBe('data-source');
    // A connection error is about the data source only when the dataset has one.
    expect(
      classifyDataIssue(new Error('connect ECONNREFUSED 127.0.0.1:9200'), { dataSource: true })
        ?.kind
    ).toBe('data-source');
    // A data source error that quotes a missing index is about the data source.
    expect(classifyDataIssue('Data Source Error: no such index [x]')?.kind).toBe('data-source');
  });

  it('the local cluster (no data source) does not answer: unreachable, not a data source', () => {
    [
      'connect ECONNREFUSED 127.0.0.1:9200',
      'No Living connections',
      'socket hang up',
      'getaddrinfo ENOTFOUND opensearch',
    ].forEach((message) => {
      expect(classifyDataIssue(new Error(message))?.kind).toBe('unreachable');
      expect(classifyDataIssue(message, { dataSource: false })?.kind).toBe('unreachable');
    });
  });

  it('a bare timeout is not classified (the pages show it as an error)', () => {
    expect(classifyDataIssue('connect ETIMEDOUT 10.0.0.1:443')).toBeUndefined();
    expect(
      classifyDataIssue('connect ETIMEDOUT 10.0.0.1:443', { dataSource: true })
    ).toBeUndefined();
  });

  it('a data source error with 401 or 403 only in its text is not a sign-in problem', () => {
    // A host:port, a count or an id that happens to read 401 / 403.
    expect(
      classifyDataIssue('Data Source Error: connect ECONNREFUSED 10.0.0.7:403', {
        dataSource: true,
      })?.kind
    ).toBe('data-source');
    expect(
      classifyDataIssue('Data Source Error: request for run 401 failed after 403 ms', {
        dataSource: true,
      })?.kind
    ).toBe('data-source');
    expect(
      classifyDataIssue('Data Source Error: {"statusCode":403,"error":"Forbidden"}', {
        dataSource: true,
      })?.kind
    ).toBe('data-source-auth');
  });

  it('a data source that cannot sign in: rejected or unreadable credentials', () => {
    // A 401 from the remote cluster, cast to 400 with its body (`createDataSourceError`).
    expect(
      classifyDataIssue(
        'Data Source Error: {"error":{"type":"security_exception","reason":"no credentials"},"status":401}'
      )?.kind
    ).toBe('data-source-auth');
    expect(classifyDataIssue('Data Source Error: Unable to decrypt the credentials')?.kind).toBe(
      'data-source-auth'
    );
    expect(
      classifyDataIssue(
        'Data Source Error: Data source "endpoint" contaminated. Please delete and create another data source.'
      )?.kind
    ).toBe('data-source-auth');
  });

  it('other errors are not classified', () => {
    expect(classifyDataIssue('Timed out')).toBeUndefined();
    expect(classifyDataIssue('Syntax error at line 1')).toBeUndefined();
    expect(classifyDataIssue(undefined)).toBeUndefined();
    expect(classifyDataIssue('')).toBeUndefined();
  });
});

describe('the null-groups probe', () => {
  it('one result without error.type, grouped by it', () => {
    expect(buildNullGroupsCheckQuery('evals-*')).toBe(
      [
        'source = evals-*',
        "where `eventName` = 'gen_ai.evaluation.result'",
        'where isnull(`attributes.error.type`)',
        'head 1',
        'stats count() as n by `attributes.error.type`',
      ].join(' | ')
    );
  });
});

describe('the data check', () => {
  it('reads one result with the fields every page aggregates on, no time bound', () => {
    expect(buildDataCheckQuery('evals-*', CORE_FIELDS)).toBe(
      [
        'source = evals-*',
        "where `eventName` = 'gen_ai.evaluation.result'",
        'fields `@timestamp`, `attributes.error.type`, `attributes.gen_ai.evaluation.score.label`, `attributes.gen_ai.evaluation.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`',
        'head 1',
      ].join(' | ')
    );
  });
});
