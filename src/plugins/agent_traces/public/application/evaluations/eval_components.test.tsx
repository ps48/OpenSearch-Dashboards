/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import {
  DeltaCell,
  PassRateCell,
  QueryErrorCallout,
  ResultRows,
  RunSelectList,
  TargetLink,
  ScoreBricks,
  SourceFilter,
  brickCount,
  bricksFilled,
  scoreScale,
} from './eval_components';
import { EvalResult, RunRow, Verdict, emptyTally } from './eval_model';
import { EvalContext, defaultEvalContext } from './eval_context';

// jsdom has no layout: AutoSizer would measure 0x0 and EuiSelectable would list no rows.
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: { children: (size: { width: number; height: number }) => unknown }) =>
    children({ width: 400, height: 400 }),
}));

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

const bricksOf = (el: HTMLElement) => ({
  total: el.querySelectorAll('.agtEvlBricks__brick').length,
  on: el.querySelectorAll('.agtEvlBricks__brick--on').length,
});

describe('scoreScale', () => {
  it('uses the declared min and max', () => {
    expect(scoreScale({ value: 4, scoreMin: 1, scoreMax: 5 })).toEqual({ min: 1, max: 5 });
    expect(scoreScale({ value: 40, scoreMin: 0, scoreMax: 100 })).toEqual({ min: 0, max: 100 });
  });

  it('falls back to 0 to 1 for a value in [0, 1)', () => {
    expect(scoreScale({ value: 0.4 })).toEqual({ min: 0, max: 1 });
    expect(scoreScale({ value: 0 })).toEqual({ min: 0, max: 1 });
    // A bare 1 may be the worst score of a 1 to 5 judge: no scale, the number shows.
    expect(scoreScale({ value: 1 })).toBeUndefined();
    expect(scoreScale({ value: 1, scoreMin: 0 })).toEqual({ min: 0, max: 1 });
    // A declared min of 0 without a max: 0 to 1 when the value fits.
    expect(scoreScale({ value: 0.5, scoreMin: 0 })).toEqual({ min: 0, max: 1 });
  });

  it('has no scale otherwise', () => {
    expect(scoreScale({})).toBeUndefined();
    expect(scoreScale({ value: 4 })).toBeUndefined();
    expect(scoreScale({ value: -0.5 })).toBeUndefined();
    // Only a max: the min is unknown.
    expect(scoreScale({ value: 0.5, scoreMax: 1 })).toBeUndefined();
    expect(scoreScale({ value: 3, scoreMin: 5, scoreMax: 5 })).toBeUndefined();
    expect(scoreScale({ value: 3, scoreMin: 5, scoreMax: 1 })).toBeUndefined();
  });
});

describe('brickCount and bricksFilled', () => {
  it('one brick per point on a 1-based integer scale up to 10', () => {
    expect(brickCount({ min: 1, max: 5 })).toBe(5);
    expect(brickCount({ min: 1, max: 3 })).toBe(3);
    expect(brickCount({ min: 1, max: 10 })).toBe(10);
    expect(bricksFilled(1, { min: 1, max: 5 })).toBe(1);
    expect(bricksFilled(4, { min: 1, max: 5 })).toBe(4);
    expect(bricksFilled(5, { min: 1, max: 5 })).toBe(5);
    expect(bricksFilled(3.6, { min: 1, max: 5 })).toBe(4);
    // Clamped to the scale.
    expect(bricksFilled(9, { min: 1, max: 5 })).toBe(5);
    expect(bricksFilled(-2, { min: 1, max: 5 })).toBe(0);
  });

  it('ten bricks by share of the scale otherwise', () => {
    expect(brickCount({ min: 0, max: 1 })).toBe(10);
    expect(brickCount({ min: 0, max: 5 })).toBe(10);
    expect(brickCount({ min: 1, max: 20 })).toBe(10);
    expect(brickCount({ min: 0.5, max: 2.5 })).toBe(10);
    expect(bricksFilled(0.4, { min: 0, max: 1 })).toBe(4);
    expect(bricksFilled(0.04, { min: 0, max: 1 })).toBe(0);
    expect(bricksFilled(2.5, { min: 0, max: 5 })).toBe(5);
    expect(bricksFilled(15, { min: 0, max: 100 })).toBe(2);
    expect(bricksFilled(150, { min: 0, max: 100 })).toBe(10);
    expect(bricksFilled(-5, { min: 0, max: 100 })).toBe(0);
  });
});

describe('ScoreBricks', () => {
  const r = (p: Partial<{ value: number; label: string; scoreMin: number; scoreMax: number }>) => ({
    verdict: 'scored' as Verdict,
    ...p,
  });

  it('fills bricks by the score, in the verdict color, with the number', () => {
    wrap(<ScoreBricks r={{ ...r({ value: 0.7 }), verdict: 'pass' }} />);
    const el = screen.getByTestId('agtEvlScoreBricks');
    expect(bricksOf(el)).toEqual({ total: 10, on: 7 });
    expect(el.querySelector('.agtEvlBricks__row--pass')).toBeInTheDocument();
    expect(el).toHaveTextContent('0.70');
    expect(el.querySelector('[aria-label="0.70 on a 0 to 1 scale"]')).toBeInTheDocument();
  });

  it('one brick per point on a 1 to 5 scale', () => {
    wrap(<ScoreBricks r={{ ...r({ value: 1, scoreMin: 1, scoreMax: 5 }), verdict: 'fail' }} />);
    const el = screen.getByTestId('agtEvlScoreBricks');
    expect(bricksOf(el)).toEqual({ total: 5, on: 1 });
    expect(el.querySelector('.agtEvlBricks__row--fail')).toBeInTheDocument();
    expect(el).toHaveTextContent('1');
  });

  it('can hide the number', () => {
    wrap(<ScoreBricks r={r({ value: 0.5 })} showValue={false} />);
    expect(screen.getByTestId('agtEvlScoreBricks')).toHaveTextContent('');
  });

  it('falls back to the number, else the label, when there is no scale', () => {
    const { unmount } = wrap(<ScoreBricks r={r({ value: 42 })} />);
    expect(screen.queryByTestId('agtEvlScoreBricks')).not.toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    unmount();
    wrap(<ScoreBricks r={r({ label: 'good' })} />);
    expect(screen.queryByTestId('agtEvlScoreBricks')).not.toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
  });
});

describe('ResultRows', () => {
  const result = (p: Partial<EvalResult> & Pick<EvalResult, 'id' | 'name' | 'verdict'>) =>
    ({ time: 0, level: 'trace', expectedTruncated: false, raw: {}, ...p }) as EvalResult;
  const results = [
    result({
      id: '1',
      name: 'accuracy',
      verdict: 'fail',
      value: 0.2,
      label: 'fail',
      explanation: 'Wrong city',
    }),
    result({ id: '2', name: 'latency', verdict: 'error', errorType: 'Throttling' }),
    result({ id: '3', name: 'tone', verdict: 'scored', label: 'polite' }),
  ];

  it('renders a row per result: name, verdict, score and explanation', () => {
    wrap(<ResultRows results={results} onOpen={jest.fn()} testId="rows" />);
    const rows = screen.getByTestId('rows').querySelectorAll('.agtEvlResultRow');
    expect(rows).toHaveLength(3);
    const [a, b, c] = Array.from(rows) as HTMLElement[];
    expect(a).toHaveTextContent('accuracy');
    expect(within(a).getByTestId('agtEvlVerdict-fail')).toBeInTheDocument();
    expect(bricksOf(within(a).getByTestId('agtEvlScoreBricks'))).toEqual({ total: 10, on: 2 });
    expect(a).toHaveTextContent('Wrong city');
    // No explanation: the error type.
    expect(within(b).getByTestId('agtEvlVerdict-error')).toBeInTheDocument();
    expect(b).toHaveTextContent('Throttling');
    // No score and no explanation: the label, and a dash.
    expect(c).toHaveTextContent('polite');
    expect(c).toHaveTextContent('—');
  });

  it('opens a result from its name', () => {
    const onOpen = jest.fn();
    wrap(<ResultRows results={results} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('latency'));
    expect(onOpen).toHaveBeenCalledWith(results[1]);
  });
});

describe('SourceFilter', () => {
  it('is a button group of All, Online and Offline', () => {
    const onChange = jest.fn();
    wrap(<SourceFilter value="online" onChange={onChange} />);
    const radio = (s: string) =>
      screen
        .getAllByTestId(`agtEvlSource-${s}`)
        .find((el) => el.tagName === 'INPUT') as HTMLElement;
    expect(radio('online')).toBeChecked();
    expect(radio('all')).not.toBeChecked();
    fireEvent.click(radio('offline'));
    expect(onChange).toHaveBeenCalledWith('offline');
  });
});

describe('DeltaCell', () => {
  it('colors a change whatever the sample size, and gives n', () => {
    wrap(<DeltaCell delta={-0.3} na={10} nb={9} />);
    const cell = screen.getByTestId('agtEvlDelta');
    expect(cell).toHaveTextContent('-30 pts');
    expect(cell).toHaveClass('agtEvlDelta--bad');
    expect(screen.getByText('n 9/10')).toBeInTheDocument();
  });
});

describe('PassRateCell', () => {
  it('shows the rate and a bar, or the bar only when bare', () => {
    const { container, unmount } = wrap(<PassRateCell rate={0.58} />);
    expect(container).toHaveTextContent('58%');
    unmount();
    const bare = wrap(<PassRateCell rate={0.58} bare />);
    expect(bare.container).not.toHaveTextContent('58%');
    expect(bare.container.querySelector('.agtEvlRate__fill')).toHaveStyle('width: 58%');
  });
});

describe('RunSelectList', () => {
  const run = (runId: string, version: string, day: number): RunRow => ({
    runId,
    version,
    started: Date.UTC(2026, 9, day, 7),
    tally: emptyTally(),
  });
  const runs = [run('run_20261027_bbbb2222', 'v1', 27), run('run_20261026_aaaa1111', 'v0', 26)];

  it('lists runs, marks the run before and picks one', () => {
    const onPick = jest.fn();
    wrap(
      <RunSelectList
        runs={runs}
        loading={false}
        onPick={onPick}
        marked="run_20261027_bbbb2222"
        testId="list"
      />
    );
    const list = screen.getByTestId('list');
    const before = within(list).getByTestId('agtEvlRunOption-run_20261027_bbbb2222');
    expect(before).toHaveTextContent('Run before');
    expect(before).toHaveTextContent('bbbb2222');
    expect(before).toHaveTextContent('v1');
    expect(within(list).getByTestId('agtEvlRunOption-run_20261026_aaaa1111')).not.toHaveTextContent(
      'Run before'
    );
    fireEvent.click(within(list).getByTestId('agtEvlRunOption-run_20261026_aaaa1111'));
    expect(onPick).toHaveBeenCalledWith('run_20261026_aaaa1111');
  });

  it('searches by run id or version', () => {
    wrap(<RunSelectList runs={runs} loading={false} onPick={jest.fn()} testId="list" />);
    const list = screen.getByTestId('list');
    fireEvent.change(within(list).getByTestId('agtEvlRunSearch'), { target: { value: 'v0' } });
    expect(within(list).getByTestId('agtEvlRunOption-run_20261026_aaaa1111')).toBeInTheDocument();
    expect(
      within(list).queryByTestId('agtEvlRunOption-run_20261027_bbbb2222')
    ).not.toBeInTheDocument();
    fireEvent.change(within(list).getByTestId('agtEvlRunSearch'), {
      target: { value: 'bbbb2222' },
    });
    expect(within(list).getByTestId('agtEvlRunOption-run_20261027_bbbb2222')).toBeInTheDocument();
    expect(
      within(list).queryByTestId('agtEvlRunOption-run_20261026_aaaa1111')
    ).not.toBeInTheDocument();
  });
});

describe('TargetLink', () => {
  const r = (p: Partial<EvalResult>) =>
    ({
      id: '1',
      name: 'x',
      verdict: 'pass',
      time: 0,
      level: 'trace',
      expectedTruncated: false,
      raw: {},
      ...p,
    }) as EvalResult;

  it('links the judged trace in a new tab without reaching the row', () => {
    const onRow = jest.fn();
    wrap(
      <div onClick={onRow} role="presentation">
        <TargetLink r={r({ traceId: 'abcdef0123456789' })} href="https://osd/x" />
      </div>
    );
    const link = screen.getByTestId('agtEvlTarget-trace');
    expect(link).toHaveAttribute('href', 'https://osd/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The level word and the popout icon, not the id (it is in the tooltip).
    expect(link).toHaveTextContent(/^Trace/);
    expect(link).not.toHaveTextContent('abcdef01');
    expect(link.querySelectorAll('[data-euiicon-type="popout"]')).toHaveLength(1);
    fireEvent.click(link);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('shows the target as text without a URL, and a dash without a target', () => {
    const { unmount } = wrap(<TargetLink r={r({ level: 'session', conversationId: 'conv-1' })} />);
    const el = screen.getByTestId('agtEvlTarget-session');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveTextContent('Session');
    unmount();
    wrap(<TargetLink r={r({ level: 'trace' })} />);
    expect(screen.queryByTestId(/^agtEvlTarget-/)).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('QueryErrorCallout', () => {
  it('a data issue: what is missing, not the raw error', () => {
    const openSettings = jest.fn();
    render(
      <I18nProvider>
        <EvalContext.Provider value={{ ...defaultEvalContext('evals-*', 'spans-*'), openSettings }}>
          <QueryErrorCallout message="Field [attributes.test.suite.run.id] not found." />
        </EvalContext.Provider>
      </I18nProvider>
    );
    const issue = screen.getByTestId('agtEvlDataIssue-field-missing');
    expect(issue).toHaveTextContent('no field attributes.test.suite.run.id');
    expect(issue).not.toHaveTextContent('Field [');
    expect(screen.queryByTestId('agtEvlQueryError')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlDataIssueSettings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('another error: its message', () => {
    wrap(<QueryErrorCallout message="Timed out" />);
    expect(screen.getByTestId('agtEvlQueryError')).toHaveTextContent('Timed out');
  });

  const inContext = (ui: React.ReactElement, dataSource?: { id: string; title: string }) =>
    render(
      <I18nProvider>
        <EvalContext.Provider value={defaultEvalContext('evals-*', 'spans-*', dataSource as never)}>
          {ui}
        </EvalContext.Provider>
      </I18nProvider>
    );

  it('a span-index query: not classified as an evaluation-index issue, the span index named', () => {
    inContext(<QueryErrorCallout on="spans" message="no such index [spans-*]" />);
    const callout = screen.getByTestId('agtEvlQueryError');
    expect(callout).toHaveTextContent('The query on the span index spans-* failed');
    expect(callout).toHaveTextContent('no such index [spans-*]');
    expect(screen.queryByTestId('agtEvlDataIssue-index-missing')).not.toBeInTheDocument();
    cleanup();
    inContext(<QueryErrorCallout on="spans" message="Field [attributes.x] not found." />);
    expect(screen.queryByText(/evaluation index template/)).not.toBeInTheDocument();
    expect(screen.getByTestId('agtEvlQueryError')).toHaveTextContent('Field [attributes.x]');
  });

  it('a connection error: the data source only when the dataset has one', () => {
    inContext(<QueryErrorCallout message="connect ECONNREFUSED 127.0.0.1:9200" />);
    expect(screen.getByTestId('agtEvlDataIssue-unreachable')).toHaveTextContent(
      'The cluster of the evaluations dataset is not reachable'
    );
    cleanup();
    inContext(<QueryErrorCallout message="connect ECONNREFUSED 10.0.0.1:443" />, {
      id: 'ds1',
      title: 'remote',
    });
    expect(screen.getByTestId('agtEvlDataIssue-data-source')).toBeInTheDocument();
  });
});
