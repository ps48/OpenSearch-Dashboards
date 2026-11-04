/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { RunPage, filterCases } from './run_page';
import { TEST_INDEX, fakePpl, renderWithContext, testContext } from './eval_test_utils';
import {
  buildCaseResultsQuery,
  buildRootSpansQuery,
  buildRunCasesQuery,
  buildRunsLookupQuery,
  buildSuiteRunsQuery,
} from './eval_ppl';
import { CaseRow, emptyTally } from './eval_model';

const SUITE = 'attributes.test.suite.name';
const RUN_ID = 'attributes.test.suite.run.id';
// jsdom has no layout: AutoSizer would measure 0x0 and EuiSelectable would list no rows.
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: { children: (size: { width: number; height: number }) => unknown }) =>
    children({ width: 400, height: 400 }),
}));

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));

const RUN = 'run_20261028_cccc3333';
const BEFORE = 'run_20261027_bbbb2222';
const base = {
  'attributes.test.suite.name': 'golden',
  'attributes.gen_ai.agent.name': 'tp',
  'attributes.gen_ai.agent.version': 'v2',
  'attributes.cicd.pipeline.run.url.full': 'https://ci/runs/77',
};
const caseRow = (id: string, name: string, verdict: string, t0: string, t1: string, run = RUN) => ({
  ...base,
  'attributes.test.suite.run.id': run,
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
      if (q.includes('stats min(`@timestamp`) as started'))
        return [
          { started: '2026-10-27 07:00:00', [SUITE]: 'golden', [RUN_ID]: BEFORE },
          { started: '2026-10-28 07:00:00', [SUITE]: 'golden', [RUN_ID]: RUN },
        ];
      if (q.includes('stats count() as n, min(`@timestamp`) as t0')) {
        const before = '2026-10-27 07:00:00';
        return [
          caseRow('c1', 'accuracy', 'fail', '2026-10-28 07:00:00', '2026-10-28 07:00:05'),
          caseRow('c1', 'tone', 'pass', '2026-10-28 07:00:00', '2026-10-28 07:00:05'),
          caseRow('c2', 'accuracy', 'error', '2026-10-28 07:00:10', '2026-10-28 07:00:20'),
          caseRow('c3', 'accuracy', 'pass', '2026-10-28 07:00:30', '2026-10-28 07:01:30'),
          ...(q.includes(BEFORE)
            ? [
                caseRow('c1', 'accuracy', 'pass', before, before, BEFORE),
                caseRow('c1', 'tone', 'pass', before, before, BEFORE),
                caseRow('c2', 'accuracy', 'pass', before, before, BEFORE),
                caseRow('c3', 'accuracy', 'fail', before, before, BEFORE),
              ]
            : []),
        ];
      }
      if (q.includes('`parentSpanId`'))
        return [
          {
            traceId: 'trace-c1',
            'attributes.gen_ai.input.messages': JSON.stringify([
              { role: 'user', parts: [{ type: 'text', content: 'Capital of France?' }] },
            ]),
            'attributes.gen_ai.output.messages': JSON.stringify([
              { role: 'assistant', parts: [{ type: 'text', content: 'Lyon' }] },
            ]),
          },
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
              opensearch: { test: { case: { expected: 'Paris' } } },
            },
          },
        ];
      if (q.includes('as started'))
        return [
          {
            n: 1,
            started: '2026-10-27 07:00:00',
            'attributes.test.suite.run.id': BEFORE,
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

  it('finds the run before, then reads both runs with one aggregation', () => {
    renderWithContext(<RunPage runId={RUN} />);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([buildRunsLookupQuery(TEST_INDEX), buildRunCasesQuery(TEST_INDEX, RUN, BEFORE)])
    );
    const meta = screen.getByTestId('agtEvlRunMeta');
    expect(meta).toHaveTextContent('golden');
    expect(meta).toHaveTextContent('tp');
    expect(meta).toHaveTextContent('1 min 30 s');
    expect(within(meta).getByText('#77')).toBeInTheDocument();
    const stat = (id: string, value: string, was: string) => {
      const el = screen.getByTestId(id);
      expect(el).toHaveTextContent(value);
      expect(el).toHaveTextContent(`was ${was} in the run before`);
    };
    stat('agtEvlStatCases', 'Cases passed 1 / 3', '2 / 3');
    stat('agtEvlStatResults', 'Results passed 2 / 3', '3 / 4');
    stat('agtEvlStatErrors', 'Evaluator errors 1', '0');
    expect(screen.getByTestId('agtEvlStatTotal')).toHaveTextContent(
      '3 cases × 2 evaluations: accuracy, tone'
    );
    const c1 = screen.getByTestId('agtEvlCaseRow-c1');
    expect(within(c1).getByText('Fail')).toBeInTheDocument();
    expect(within(c1).getByText('accuracy')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('agtEvlCaseRow-c2')).getByText('Evaluator error')
    ).toBeInTheDocument();
  });

  it('Compare with run before is the primary action', () => {
    const { ctx } = renderWithContext(<RunPage runId={RUN} />);
    fireEvent.click(screen.getByTestId('agtEvlCompareRunBefore'));
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'compare', runA: BEFORE, runB: RUN });
  });

  it('a first run has no run before: one run, no comparison figures', () => {
    mockPpl.answer((q) =>
      q.includes('stats min(`@timestamp`) as started')
        ? [{ started: '2026-10-28 07:00:00', [SUITE]: 'golden', [RUN_ID]: RUN }]
        : q.includes('as t0')
          ? [caseRow('c1', 'accuracy', 'pass', '2026-10-28 07:00:00', '2026-10-28 07:00:05')]
          : []
    );
    renderWithContext(<RunPage runId={RUN} />);
    expect(mockPpl.queries).toContain(buildRunCasesQuery(TEST_INDEX, RUN));
    expect(screen.queryByTestId('agtEvlCompareRunBefore')).not.toBeInTheDocument();
    expect(screen.getByTestId('agtEvlStatCases')).not.toHaveTextContent('run before');
  });

  it('expands a case: input, output (root span), expected and its results', () => {
    const { ctx } = renderWithContext(<RunPage runId={RUN} />);
    fireEvent.click(screen.getByTestId('agtEvlCaseRow-c1'));
    expect(mockPpl.queries).toContain(buildCaseResultsQuery(TEST_INDEX, RUN, 'c1'));
    expect(mockPpl.queries).toContain(buildRootSpansQuery('spans-*', ['trace-c1']));
    const results = screen.getByTestId('agtEvlCaseResults-c1');
    const io = within(results).getByTestId('agtEvlCaseIO');
    const section = (key: string) => within(io).getByTestId(`agtEvlIO-${key}`);
    expect(
      within(io)
        .getAllByTestId(/^agtEvlIO-/)
        .map((el) => el.getAttribute('data-test-subj'))
    ).toEqual(['agtEvlIO-input', 'agtEvlIO-output', 'agtEvlIO-expected']);
    // Role-labelled messages from the gen_ai.*.messages JSON.
    expect(section('input')).toHaveTextContent('Input');
    expect(section('input')).toHaveTextContent('User');
    expect(section('input')).toHaveTextContent('Capital of France?');
    expect(section('output')).toHaveTextContent('Assistant');
    expect(section('output')).toHaveTextContent('Lyon');
    expect(section('expected')).toHaveTextContent('Paris');
    expect(section('expected')).toHaveTextContent('opensearch.test.case.expected');
    // Formatted / JSON toggle: the JSON view shows the attribute itself.
    fireEvent.click(
      within(io).getByTestId('agentTracesMessageViewJson').querySelector('input') as HTMLElement
    );
    expect(section('input')).toHaveTextContent('"role": "user"');
    const rows = within(results).getByTestId('agtEvlCaseResultRows');
    expect(rows).toHaveTextContent('Wrong city');
    expect(within(rows).getByTestId('agtEvlVerdict-fail')).toBeInTheDocument();
    fireEvent.click(within(rows).getByText('accuracy'));
    expect(ctx.openResult).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'accuracy', verdict: 'fail' })
    );
  });

  it('reads the run before, the cases and the suite runs over the browse range', () => {
    const browseRange = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' };
    const timeRange = { from: '2026-10-28T07:00:00.000Z', to: '2026-10-28T07:02:00.000Z' };
    renderWithContext(<RunPage runId={RUN} />, testContext({ browseRange, timeRange }));
    fireEvent.click(screen.getByTestId('agtEvlCompareWith'));
    expect(mockPpl.ranges.get(buildRunsLookupQuery(TEST_INDEX))).toEqual(browseRange);
    expect(mockPpl.ranges.get(buildRunCasesQuery(TEST_INDEX, RUN, BEFORE))).toEqual(browseRange);
    expect(mockPpl.ranges.get(buildSuiteRunsQuery(TEST_INDEX, 'golden'))).toEqual(browseRange);
  });

  it('Compare with… is disabled with a tooltip when the suite has no other run', async () => {
    mockPpl.answer((q) =>
      q.includes('stats min(`@timestamp`) as started')
        ? [
            { started: '2026-10-28 07:00:00', [SUITE]: 'golden', [RUN_ID]: RUN },
            { started: '2026-10-27 07:00:00', [SUITE]: 'other', [RUN_ID]: 'x' },
          ]
        : q.includes('as t0')
          ? [caseRow('c1', 'accuracy', 'pass', '2026-10-28 07:00:00', '2026-10-28 07:00:05')]
          : []
    );
    renderWithContext(<RunPage runId={RUN} />);
    const button = screen.getByTestId('agtEvlCompareWith');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockPpl.queries).not.toContain(buildSuiteRunsQuery(TEST_INDEX, 'golden'));
    // EUI opens the tooltip after a delay and a queued state change (real timers).
    fireEvent.mouseOver(button.closest('.euiToolTipAnchor') as HTMLElement);
    expect(
      await screen.findByText(/^No other run of this suite in Last 7 days/, undefined, {
        timeout: 5000,
      })
    ).toBeInTheDocument();
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
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([buildRunsLookupQuery(TEST_INDEX), buildRunCasesQuery(TEST_INDEX, RUN, BEFORE)])
    );
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
    const list = screen.getByTestId('agtEvlCompareWithList');
    // The other runs of the suite only, searchable; the run before is marked.
    expect(within(list).queryByTestId(`agtEvlRunOption-${RUN}`)).not.toBeInTheDocument();
    const item = within(list).getByTestId('agtEvlRunOption-run_20261027_bbbb2222');
    expect(item).toHaveTextContent('Run before');
    expect(item).toHaveTextContent('bbbb2222');
    expect(item).toHaveTextContent('v1');
    expect(within(list).getByTestId('agtEvlRunSearch')).toBeInTheDocument();
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
