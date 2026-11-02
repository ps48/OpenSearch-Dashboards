/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { RunPage, filterCases } from './run_page';
import { TEST_INDEX, fakePpl, renderWithContext } from './eval_test_utils';
import { buildCaseResultsQuery, buildRunCasesQuery, buildSuiteRunsQuery } from './eval_ppl';
import { CaseRow, emptyTally } from './eval_model';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));

const RUN = 'run_20261028_cccc3333';
const base = {
  'attributes.test.suite.name': 'golden',
  'attributes.gen_ai.agent.name': 'tp',
  'attributes.gen_ai.agent.version': 'v2',
  'attributes.cicd.pipeline.run.url.full': 'https://ci/runs/77',
};
const caseRow = (id: string, name: string, verdict: string, t0: string, t1: string) => ({
  ...base,
  n: 1,
  t0,
  t1,
  'attributes.test.case.id': id,
  'attributes.test.case.name': `Case ${id}`,
  'attributes.gen_ai.evaluation.name': name,
  verdict,
  traceId: `trace-${id}`,
});

describe('RunPage', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockPpl.answer((q) => {
      if (q.includes('stats count() as n, min(`@timestamp`) as t0'))
        return [
          caseRow('c1', 'accuracy', 'fail', '2026-10-28 07:00:00', '2026-10-28 07:00:05'),
          caseRow('c1', 'tone', 'pass', '2026-10-28 07:00:00', '2026-10-28 07:00:05'),
          caseRow('c2', 'accuracy', 'error', '2026-10-28 07:00:10', '2026-10-28 07:00:20'),
          caseRow('c3', 'accuracy', 'pass', '2026-10-28 07:00:30', '2026-10-28 07:01:30'),
        ];
      if (q.endsWith('| head 100'))
        return [
          {
            '@timestamp': '2026-10-28 07:00:01',
            traceId: 'trace-c1',
            attributes: {
              gen_ai: {
                evaluation: {
                  name: 'accuracy',
                  score: { value: 0.2, label: 'fail' },
                  explanation: 'Wrong city',
                },
              },
            },
          },
        ];
      if (q.includes('as started'))
        return [
          {
            n: 1,
            started: '2026-10-27 07:00:00',
            'attributes.test.suite.run.id': 'run_20261027_bbbb2222',
            'attributes.gen_ai.agent.version': 'v1',
            verdict: 'pass',
          },
          {
            n: 1,
            started: '2026-10-28 07:00:00',
            'attributes.test.suite.run.id': RUN,
            'attributes.gen_ai.agent.version': 'v2',
            verdict: 'pass',
          },
        ];
      return [];
    });
  });

  it('reads the run with one aggregation: header, figures and cases', () => {
    renderWithContext(<RunPage runId={RUN} />);
    expect(new Set(mockPpl.queries)).toEqual(new Set([buildRunCasesQuery(TEST_INDEX, RUN)]));
    const meta = screen.getByTestId('agtEvlRunMeta');
    expect(meta).toHaveTextContent('golden');
    expect(meta).toHaveTextContent('tp');
    expect(meta).toHaveTextContent('1 min 30 s');
    expect(within(meta).getByText('#77')).toBeInTheDocument();
    const stats = screen.getByTestId('agtEvlRunStats');
    expect(stats).toHaveTextContent('1 / 3');
    expect(stats).toHaveTextContent('67%');
    const c1 = screen.getByTestId('agtEvlCaseRow-c1');
    expect(within(c1).getByText('Fail')).toBeInTheDocument();
    expect(within(c1).getByText('accuracy')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('agtEvlCaseRow-c2')).getByText('Evaluator error')
    ).toBeInTheDocument();
  });

  it('expands a case and reads only its results', () => {
    const { ctx } = renderWithContext(<RunPage runId={RUN} />);
    fireEvent.click(screen.getByTestId('agtEvlCaseRow-c1'));
    expect(mockPpl.queries).toContain(buildCaseResultsQuery(TEST_INDEX, RUN, 'c1'));
    const results = screen.getByTestId('agtEvlCaseResults-c1');
    expect(results).toHaveTextContent('Wrong city');
    fireEvent.click(within(results).getByText('accuracy'));
    expect(ctx.openResult).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'accuracy', verdict: 'fail' })
    );
  });

  it('filters cases by status and search in the browser', () => {
    renderWithContext(<RunPage runId={RUN} />);
    fireEvent.click(screen.getByTestId('agtEvlCaseStatus-error'));
    expect(screen.queryByTestId('agtEvlCaseRow-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('agtEvlCaseRow-c2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlCaseStatus-all'));
    fireEvent.change(screen.getByTestId('agtEvlCaseSearch'), { target: { value: 'c3' } });
    expect(screen.getByTestId('agtEvlCaseRow-c3')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlCaseRow-c2')).not.toBeInTheDocument();
    // Status and search run in the browser only.
    expect(new Set(mockPpl.queries)).toEqual(new Set([buildRunCasesQuery(TEST_INDEX, RUN)]));
  });

  it('View trace opens the case trace', () => {
    const { ctx } = renderWithContext(<RunPage runId={RUN} />);
    fireEvent.click(screen.getByTestId('agtEvlViewTrace-c3'));
    expect(ctx.openTrace).toHaveBeenCalledWith('trace-c3', Date.UTC(2026, 9, 28, 7, 0, 30));
  });

  it('Compare with… reads the suite runs when opened, the run before first', () => {
    const { ctx } = renderWithContext(<RunPage runId={RUN} />);
    fireEvent.click(screen.getByTestId('agtEvlCompareWith'));
    expect(mockPpl.queries).toContain(buildSuiteRunsQuery(TEST_INDEX, 'golden'));
    const item = screen.getByTestId('agtEvlCompareWith-run_20261027_bbbb2222');
    expect(item).toHaveTextContent('Run before');
    fireEvent.click(item);
    expect(ctx.navigate).toHaveBeenCalledWith({
      page: 'compare',
      runA: 'run_20261027_bbbb2222',
      runB: RUN,
    });
  });

  it('filterCases matches name and id', () => {
    const c = (caseId: string, status: CaseRow['status']): CaseRow => ({
      caseId,
      caseName: `Name ${caseId}`,
      at: 0,
      tally: emptyTally(),
      status,
      failed: [],
      errored: [],
      byEvaluation: new Map(),
    });
    const cases = [c('a', 'pass'), c('b', 'fail')];
    expect(filterCases(cases, 'fail', '').map((x) => x.caseId)).toEqual(['b']);
    expect(filterCases(cases, 'all', 'NAME A').map((x) => x.caseId)).toEqual(['a']);
  });
});
