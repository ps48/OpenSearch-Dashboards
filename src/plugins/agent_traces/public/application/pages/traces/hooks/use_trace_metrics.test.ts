/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { doFetchMetrics } from './use_trace_metrics';
import { PPLService } from '../trace_details/data_fetching/ppl_request_helpers';
import { Dataset } from '../../../../../../data/common';
import { resetAiRootFieldChecks } from '../../../utils/ai_root';

const DATASET = { id: 'spans', title: 'otel-v1-apm-span*', type: 'INDEX_PATTERN' } as Dataset;
const SOURCE = 'source = otel-v1-apm-span*';
const FILTERED = `${SOURCE} | where serviceName = 'svc'`;

const fakePpl = () => {
  const queries: string[] = [];
  const service = {
    executeQuery: jest.fn(async (_d: Dataset, q: string) => {
      queries.push(q);
      return { schema: [], datarows: [] };
    }),
  };
  return { queries, service: service as unknown as PPLService };
};

describe('doFetchMetrics', () => {
  beforeEach(() => resetAiRootFieldChecks());

  it("counts traces, spans and sessions with the table's filter, not the whole source", async () => {
    const { queries, service } = fakePpl();
    await doFetchMetrics(service, DATASET, SOURCE, `${FILTERED} | sort - endTime | head 10`);
    const counts = queries.find((q) => q.includes('as total_traces'));
    const sessions = queries.find((q) => q.includes('as total_sessions'));
    const filtered = queries.find((q) => q.includes('as filtered_traces'));
    // The same where clause as the table (sort and head left out of the aggregations).
    expect(counts?.startsWith(`${FILTERED} | where `)).toBe(true);
    expect(sessions?.startsWith(`${FILTERED} | where `)).toBe(true);
    expect(filtered?.startsWith(`${FILTERED} | where `)).toBe(true);
    [counts, sessions].forEach((q) => expect(q).not.toContain('head 10'));
  });

  it('without a filter, the counts read the whole source', async () => {
    const { queries, service } = fakePpl();
    await doFetchMetrics(service, DATASET, SOURCE, SOURCE);
    const counts = queries.find((q) => q.includes('as total_traces'));
    expect(counts?.startsWith(`${SOURCE} | where `)).toBe(true);
  });
});
