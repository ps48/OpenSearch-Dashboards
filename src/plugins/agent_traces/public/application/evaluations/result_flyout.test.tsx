/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { ResultFlyout, scalePosition } from './result_flyout';
import { recordToResult } from './eval_model';
import { TEST_INDEX, fakePpl, renderWithContext } from './eval_test_utils';
import {
  buildCaseResultsQuery,
  buildOneTraceSpansQuery,
  buildRootSpansQuery,
  buildRunsLookupQuery,
  buildSpanQuery,
} from './eval_ppl';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));
const mockCompare = jest.fn();
jest.mock('./trace_compare_flyout', () => ({
  ...jest.requireActual('./trace_compare_flyout'),
  TraceCompareFlyout: (props: unknown) => {
    mockCompare(props);
    return <div data-test-subj="traceCompare" />;
  },
}));

const RUN = 'run_20261028_abcd1234';
const BEFORE = 'run_20261027_beef0000';
const msg = (role: string, content: string) =>
  JSON.stringify([{ role, parts: [{ type: 'text', content }] }]);
const caseDoc = (run: string, name: string, label: string, traceId: string, why = '') => ({
  '@timestamp': '2026-10-28 07:00:02',
  traceId,
  attributes: {
    gen_ai: { evaluation: { name, score: { label }, explanation: why }, agent: { version: 'v2' } },
    test: { suite: { run: { id: run } }, case: { id: 'c1' } },
  },
});

const SUITE = 'attributes.test.suite.name';
const RUN_ID = 'attributes.test.suite.run.id';

const offline = recordToResult({
  '@timestamp': '2026-10-28 07:00:01',
  traceId: 'trace1',
  spanId: 'span1',
  attributes: {
    gen_ai: {
      evaluation: {
        name: 'helpfulness',
        score: { value: 0.4, label: 'fail' },
        explanation: 'Vague.',
      },
      agent: { name: 'tp', version: 'v3' },
    },
    opensearch: {
      gen_ai: {
        evaluation: {
          level: 'span',
          score: { min: 0, max: 1 },
          evaluator: { name: 'helpfulness_judge', type: 'llm_judge' },
          judge: { trace_id: 'judge1' },
        },
      },
      test: { case: { expected: 'Paris' } },
    },
    test: {
      suite: { name: 'golden', run: { id: RUN } },
      case: { id: 'c1', name: 'Case 1' },
    },
  },
});

const renderFlyout = (r = offline, links = {}, onOpenResult = jest.fn()) =>
  renderWithContext(
    <ResultFlyout result={r} onClose={jest.fn()} links={links} onOpenResult={onOpenResult} />
  );

describe('ResultFlyout', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockCompare.mockClear();
    mockPpl.answer((q) => {
      if (q.includes("`spanId` = 'span1'"))
        return [
          {
            traceId: 'trace1',
            spanId: 'span1',
            name: 'execute_tool search_flights',
            attributes: { gen_ai: { tool: { call: { arguments: '{"to":"CDG"}' } } } },
            'attributes.gen_ai.tool.call.result': '3 flights',
          },
        ];
      if (q.includes('`parentSpanId`'))
        return [
          {
            traceId: 't',
            'attributes.gen_ai.input.messages': msg('user', 'Hello'),
            'attributes.gen_ai.output.messages': msg('assistant', 'Hi there'),
          },
        ];
      if (q.includes('stats min(`@timestamp`) as started'))
        return [
          { started: '2026-10-27 07:00:00', [SUITE]: 'golden', [RUN_ID]: BEFORE },
          { started: '2026-10-28 07:00:00', [SUITE]: 'golden', [RUN_ID]: RUN },
        ];
      if (q.endsWith('head 100'))
        return [
          {
            ...caseDoc(RUN, 'helpfulness', 'fail', 'trace1'),
            '@timestamp': '2026-10-28 07:00:01',
            spanId: 'span1',
          },
          caseDoc(RUN, 'tone', 'pass', 'trace1', 'Polite'),
          caseDoc(BEFORE, 'helpfulness', 'pass', 'trace0'),
        ];
      if (q.includes("`traceId` = 'judge1'"))
        return [
          {
            traceId: 'judge1',
            spanId: 'j-root',
            parentSpanId: '',
            name: 'chat claude',
            startTime: '2026-10-28 07:00:01',
            endTime: '2026-10-28 07:00:03',
            durationInNanos: 2e9,
            attributes: {
              gen_ai: {
                operation: { name: 'chat' },
                request: { model: 'claude-sonnet-4-5' },
                input: { messages: msg('user', 'Grade this answer for helpfulness') },
                output: { messages: msg('assistant', 'score: 0.4') },
                usage: { input_tokens: 900, output_tokens: 100 },
              },
            },
          },
        ];
      return [];
    });
  });

  it('shows what the judge saw: the judged span and the expected output (one span query)', () => {
    renderFlyout();
    expect(mockPpl.queries).toContain(buildSpanQuery('spans-*', 'trace1', 'span1'));
    expect(screen.getByTestId('agtEvlFlyoutJudged')).toHaveTextContent(
      'span execute_tool search_flights'
    );
    expect(screen.getByTestId('agtEvlJudgedInput')).toHaveTextContent('{"to":"CDG"}');
    expect(screen.getByTestId('agtEvlJudgedOutput')).toHaveTextContent('3 flights');
    expect(screen.getByTestId('agtEvlJudgedExpected')).toHaveTextContent('Paris');
  });

  it('shows the case: its other results, and the run before with Compare traces', () => {
    const open = jest.fn();
    renderFlyout(offline, {}, open);
    expect(mockPpl.queries).toContain(buildRunsLookupQuery(TEST_INDEX));
    expect(mockPpl.queries).toContain(buildCaseResultsQuery(TEST_INDEX, [RUN, BEFORE], 'c1'));
    const c = screen.getByTestId('agtEvlFlyoutCase');
    expect(c).toHaveTextContent('Polite');
    expect(within(c).queryAllByText('helpfulness')).toHaveLength(0);
    expect(screen.getByTestId('agtEvlFlyoutRunBefore')).toHaveTextContent(
      'In the run before (beef0000, v2): Pass → Fail'
    );
    fireEvent.click(within(c).getByText('tone'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ name: 'tone' }));
    fireEvent.click(screen.getByTestId('agtEvlFlyoutCompareTraces'));
    expect(mockCompare).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'c1', traceA: 'trace0', traceB: 'trace1' })
    );
  });

  it('opens the judge trace only on click: spans, prompt and response, and back', () => {
    renderFlyout();
    expect(mockPpl.queries).not.toContain(buildOneTraceSpansQuery('spans-*', 'judge1'));
    fireEvent.click(screen.getByTestId('agtEvlFlyoutJudgeTrace'));
    expect(mockPpl.queries).toContain(buildOneTraceSpansQuery('spans-*', 'judge1'));
    const judge = screen.getByTestId('agtEvlJudgeTrace');
    expect(judge).toHaveTextContent('claude-sonnet-4-5');
    expect(judge).toHaveTextContent('1,000 tokens');
    expect(screen.getByTestId('agtEvlJudgePrompt')).toHaveTextContent(
      'Grade this answer for helpfulness'
    );
    expect(screen.getByTestId('agtEvlJudgeResponse')).toHaveTextContent('score: 0.4');
    fireEvent.click(screen.getByTestId('agtEvlJudgeBack'));
    expect(screen.getByTestId('agtEvlJudgeSaw')).toBeInTheDocument();
  });

  it('shows verdict, score on its scale, label, explanation, evaluator and the raw event', () => {
    renderFlyout();
    expect(screen.getByText('helpfulness')).toBeInTheDocument();
    expect(screen.getAllByTestId('agtEvlVerdict-fail').length).toBeGreaterThan(0);
    expect(screen.getByTestId('agtEvlFlyoutScore')).toHaveTextContent('0.40 / 1');
    expect(screen.getByTestId('agtEvlFlyoutScale')).toBeInTheDocument();
    expect(screen.getByText('Vague.')).toBeInTheDocument();
    expect(screen.getByText('helpfulness_judge')).toBeInTheDocument();
    expect(screen.getByText('llm_judge')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlRawEvent')).toBeInTheDocument();
  });

  it('links the trace, the suite and the run', () => {
    const links = { openTrace: jest.fn(), openSuite: jest.fn(), openRun: jest.fn() };
    renderFlyout(offline, links);
    fireEvent.click(screen.getByTestId('agtEvlFlyoutViewTrace'));
    expect(links.openTrace).toHaveBeenCalledWith('trace1', offline.time);
    fireEvent.click(screen.getByText('golden'));
    expect(links.openSuite).toHaveBeenCalledWith('golden');
    fireEvent.click(screen.getByText('abcd1234'));
    expect(links.openRun).toHaveBeenCalledWith(RUN);
  });

  it('online results without an agent name judge the whole trace', () => {
    renderFlyout(
      recordToResult({
        '@timestamp': '2026-10-28 07:00:01',
        traceId: 't',
        attributes: { gen_ai: { evaluation: { name: 'toxicity', score: { value: 0.1 } } } },
      })
    );
    expect(screen.getByText(/\(no agent name\)/)).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlVerdict-scored')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlFlyoutJudged')).toHaveTextContent(
      'the whole trace (root span)'
    );
    expect(mockPpl.queries).toContain(buildRootSpansQuery('spans-*', ['t']));
    expect(screen.getByTestId('agtEvlJudgedInput')).toHaveTextContent('Hello');
    expect(screen.getByTestId('agtEvlJudgedOutput')).toHaveTextContent('Hi there');
    expect(screen.queryByTestId('agtEvlJudgedExpected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlFlyoutCase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlFlyoutJudgeTrace')).not.toBeInTheDocument();
    expect(screen.getByText('Online (live traffic)')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlFlyoutScale')).not.toBeInTheDocument();
  });

  it('places a score on its declared scale', () => {
    expect(scalePosition({ value: 4, scoreMin: 1, scoreMax: 5 })).toBe(0.75);
    expect(scalePosition({ value: 4 })).toBeUndefined();
    expect(scalePosition({ value: 9, scoreMin: 0, scoreMax: 5 })).toBe(1);
  });
});
