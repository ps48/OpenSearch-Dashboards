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
  buildSessionRootsQuery,
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
    const io = screen.getByTestId('agtEvlJudgedIO');
    expect(
      within(io)
        .getAllByTestId(/^agtEvlIO-/)
        .map((el) => el.getAttribute('data-test-subj'))
    ).toEqual(['agtEvlIO-input', 'agtEvlIO-output', 'agtEvlIO-expected']);
    // A tool span: its arguments and result.
    expect(within(io).getByTestId('agtEvlIO-input')).toHaveTextContent('"to":"CDG"');
    expect(within(io).getByTestId('agtEvlIO-output')).toHaveTextContent('3 flights');
    expect(within(io).getByTestId('agtEvlIO-expected')).toHaveTextContent('Paris');
    expect(within(io).getByTestId('agtEvlIO-expected')).toHaveTextContent(
      'opensearch.test.case.expected'
    );
  });

  it('says when the judged span is not in the span index', () => {
    mockPpl.answer(() => []);
    renderFlyout();
    expect(screen.getByTestId('agtEvlJudgedMissing')).toHaveTextContent(
      'The judged trace is not in the span index'
    );
    expect(screen.queryByTestId('agtEvlJudgedIO')).not.toBeInTheDocument();
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
    const io = within(judge).getByTestId('agtEvlJudgeIO');
    const prompt = within(io).getByTestId('agtEvlIO-prompt');
    expect(prompt).toHaveTextContent('Prompt sent to the judge');
    expect(prompt).toHaveTextContent('User');
    expect(prompt).toHaveTextContent('Grade this answer for helpfulness');
    const response = within(io).getByTestId('agtEvlIO-response');
    expect(response).toHaveTextContent('Judge response');
    expect(response).toHaveTextContent('Assistant');
    expect(response).toHaveTextContent('score: 0.4');
    // The raw gen_ai.input.messages / gen_ai.output.messages values in the JSON view.
    fireEvent.click(
      within(io).getByTestId('agentTracesMessageViewJson').querySelector('input') as HTMLElement
    );
    expect(within(io).getByTestId('agtEvlIO-prompt')).toHaveTextContent('"role": "user"');
    expect(within(io).getByTestId('agtEvlIO-response')).toHaveTextContent(
      '"content": "score: 0.4"'
    );
    fireEvent.click(screen.getByTestId('agtEvlJudgeBack'));
    expect(screen.getByTestId('agtEvlJudgeSaw')).toBeInTheDocument();
  });

  it('shows verdict, score on its scale, label, explanation, evaluator and the raw event', () => {
    renderFlyout();
    expect(screen.getByText('helpfulness')).toBeInTheDocument();
    expect(screen.getAllByTestId('agtEvlVerdict-fail').length).toBeGreaterThan(0);
    expect(screen.getByTestId('agtEvlFlyoutScore')).toHaveTextContent('0.40 / 1');
    const scale = screen.getByTestId('agtEvlFlyoutScale');
    const bricks = within(scale).getByTestId('agtEvlScoreBricks');
    // 0.4 on 0 to 1: 4 of 10 bricks, in the verdict color, no number repeated.
    expect(bricks.querySelectorAll('.agtEvlBricks__brick')).toHaveLength(10);
    expect(bricks.querySelectorAll('.agtEvlBricks__brick--on')).toHaveLength(4);
    expect(bricks.querySelector('.agtEvlBricks__row--fail')).toBeInTheDocument();
    expect(bricks).not.toHaveTextContent('0.40');
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
    const io = screen.getByTestId('agtEvlJudgedIO');
    expect(within(io).getByTestId('agtEvlIO-input')).toHaveTextContent('Hello');
    expect(within(io).getByTestId('agtEvlIO-output')).toHaveTextContent('Hi there');
    // Online: no expected output.
    expect(within(io).queryByTestId('agtEvlIO-expected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlFlyoutCase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlFlyoutJudgeTrace')).not.toBeInTheDocument();
    expect(screen.getByText('Online (live traffic)')).toBeInTheDocument();
    // No declared scale, but 0.1 fits 0 to 1: bricks on that scale.
    const scale = screen.getByTestId('agtEvlFlyoutScale');
    expect(scale.querySelectorAll('.agtEvlBricks__brick--on')).toHaveLength(1);
    expect(scale.querySelector('.agtEvlBricks__row--scored')).toBeInTheDocument();
  });

  it('has no scale for a score outside 0 to 1 without a declared scale', () => {
    renderFlyout(
      recordToResult({
        '@timestamp': '2026-10-28 07:00:01',
        traceId: 't',
        attributes: { gen_ai: { evaluation: { name: 'latency', score: { value: 42 } } } },
      })
    );
    expect(screen.queryByTestId('agtEvlFlyoutScale')).not.toBeInTheDocument();
  });

  describe('session-level results', () => {
    const CONV = 'conv-1234567890abcdef';
    const session = (conversationId?: string) =>
      recordToResult({
        '@timestamp': '2026-10-28 07:00:01',
        traceId: 'turn-3',
        attributes: {
          gen_ai: {
            evaluation: { name: 'goal_success', score: { label: 'pass' } },
            agent: { name: 'tp' },
            ...(conversationId ? { conversation: { id: conversationId } } : {}),
          },
          opensearch: { gen_ai: { evaluation: { level: 'session' } } },
        },
      });

    it('shows the first input and the last output of the session turns (one query)', () => {
      mockPpl.answer((q) =>
        q === buildSessionRootsQuery('spans-*', CONV)
          ? [
              {
                traceId: 'turn-1',
                'attributes.gen_ai.input.messages': msg('user', 'Plan a trip to Paris'),
                'attributes.gen_ai.output.messages': msg('assistant', 'Which dates?'),
              },
              {
                traceId: 'turn-2',
                'attributes.gen_ai.input.messages': msg('user', 'Next week'),
                'attributes.gen_ai.output.messages': msg('assistant', 'Booked: 3 nights'),
              },
            ]
          : []
      );
      const links = { openSession: jest.fn() };
      renderFlyout(session(CONV), links);
      expect(mockPpl.queries).toContain(buildSessionRootsQuery('spans-*', CONV));
      // No root span or span query: the session is read through its turns.
      expect(new Set(mockPpl.queries.filter((q) => q.startsWith('source = spans-*')))).toEqual(
        new Set([buildSessionRootsQuery('spans-*', CONV)])
      );
      const saw = screen.getByTestId('agtEvlJudgeSawSession');
      expect(screen.queryByTestId('agtEvlJudgeSaw')).not.toBeInTheDocument();
      expect(within(saw).getByTestId('agtEvlFlyoutJudged')).toHaveTextContent('the whole session');
      expect(within(saw).getByTestId('agtEvlFlyoutJudged')).toHaveTextContent('2 turns');
      const io = within(saw).getByTestId('agtEvlJudgedIO');
      const input = within(io).getByTestId('agtEvlIO-input');
      expect(input).toHaveTextContent('First input');
      expect(input).toHaveTextContent('Plan a trip to Paris');
      const output = within(io).getByTestId('agtEvlIO-output');
      expect(output).toHaveTextContent('Last output');
      expect(output).toHaveTextContent('Booked: 3 nights');
      expect(output).not.toHaveTextContent('Which dates?');
      fireEvent.click(within(saw).getByTestId('agtEvlFlyoutViewSession'));
      expect(links.openSession).toHaveBeenCalledWith(CONV, session(CONV).time);
    });

    it('has no View session link without an openSession link', () => {
      renderFlyout(session(CONV));
      expect(screen.queryByTestId('agtEvlFlyoutViewSession')).not.toBeInTheDocument();
    });

    it('says when the session has no traces in the span index', () => {
      mockPpl.answer(() => []);
      renderFlyout(session(CONV), { openSession: jest.fn() });
      expect(screen.getByTestId('agtEvlJudgedMissing')).toHaveTextContent(
        'The session has no traces in the span index'
      );
      expect(screen.queryByTestId('agtEvlJudgedIO')).not.toBeInTheDocument();
    });

    it('runs no query and links nothing when the result has no conversation id', () => {
      renderFlyout(session(), { openSession: jest.fn() });
      expect(screen.getByTestId('agtEvlFlyoutJudged')).toHaveTextContent(
        'the result has no gen_ai.conversation.id'
      );
      expect(mockPpl.queries.filter((q) => q.startsWith('source = spans-*'))).toEqual([]);
      expect(screen.queryByTestId('agtEvlFlyoutViewSession')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agtEvlJudgedMissing')).not.toBeInTheDocument();
    });
  });

  it('places a score on its declared scale', () => {
    expect(scalePosition({ value: 4, scoreMin: 1, scoreMax: 5 })).toBe(0.75);
    expect(scalePosition({ value: 4 })).toBeUndefined();
    expect(scalePosition({ value: 9, scoreMin: 0, scoreMax: 5 })).toBe(1);
  });
});
