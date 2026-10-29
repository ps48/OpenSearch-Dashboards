/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { RunsTab } from './runs_tab';
import { EMPTY_RUN_EVENTS, EvalResult, RunEvents } from './eval_data';
import { summarizeRuns } from './eval_aggregations';
import { makeResult, twoRunEventsFixture, twoRunFixture } from './eval_test_fixtures';

type RenderProps = Partial<React.ComponentProps<typeof RunsTab>> & {
  results?: EvalResult[];
  events?: RunEvents;
};

/** The runs list and the compared runs from the same grades and events. */
const renderRuns = ({ results = twoRunFixture(), events, ...props }: RenderProps = {}) => {
  const onCompareChange = jest.fn();
  const onOpenTrace = jest.fn();
  render(
    <I18nProvider>
      <RunsTab
        runs={summarizeRuns(results, events)}
        compareData={{ loading: false, results, events: events ?? EMPTY_RUN_EVENTS, missing: [] }}
        onCompareChange={onCompareChange}
        onOpenTrace={onOpenTrace}
        {...props}
      />
    </I18nProvider>
  );
  return { onCompareChange, onOpenTrace };
};

describe('RunsTab', () => {
  it('explains how to produce runs when there are none', () => {
    renderRuns({ results: [] });
    expect(screen.getByTestId('agtEvlNoRuns')).toHaveTextContent('test.suite.run.id');
  });

  it('lists runs with cases, per-evaluation means and a regression marker', () => {
    renderRuns();
    const table = screen.getByTestId('agtEvlRunsTable');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('run-2')).toBeInTheDocument();
    expect(within(rows[0]).getByTestId('agtEvlRegression')).toBeInTheDocument();
    expect(within(rows[0]).getByText('0.57')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('agtEvlRegression')).not.toBeInTheDocument();
    // Against the previous run of the suite: 0.65 to 0.57, worse.
    const delta = within(rows[0]).getByTestId('agtEvlRunsDelta');
    expect(delta).toHaveTextContent('↓8 pp');
    expect(delta).toHaveAttribute('data-change', 'regressed');
    expect(within(rows[1]).queryByTestId('agtEvlRunsDelta')).not.toBeInTheDocument();
  });

  it('shows the agent version, model, status and usage from the run metadata', () => {
    const events = twoRunEventsFixture();
    events.runs[1].metadata = {
      'agent.version': 'v2',
      'agent.model': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      'usage.total_tokens': '12345',
    };
    renderRuns({ events });
    const [latest, first] = within(screen.getByTestId('agtEvlRunsTable'))
      .getAllByRole('row')
      .slice(1);
    expect(within(latest).getByTestId('agtEvlRunAgentVersion')).toHaveTextContent('v2');
    expect(within(latest).getByTestId('agtEvlRunModel')).toHaveTextContent('claude-haiku-4-5');
    expect(within(latest).getByTestId('agtEvlRunTokens')).toHaveTextContent('12.3k');
    expect(within(first).getByTestId('agtEvlRunCompleted')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlRunCost')).not.toBeInTheDocument();
  });

  it('compares two selected runs of a suite, oldest as baseline', () => {
    const { onCompareChange } = renderRuns();
    const button = screen.getByTestId('agtEvlCompareButton');
    expect(button).toBeDisabled();
    // Row checkboxes only (the header has select-all boxes for desktop and mobile).
    const boxes = () =>
      Array.from(
        screen
          .getByTestId('agtEvlRunsTable')
          .querySelectorAll<HTMLElement>('tbody input[type=checkbox]')
      );
    fireEvent.click(boxes()[0]);
    expect(button).toBeDisabled();
    fireEvent.click(boxes()[1]);
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onCompareChange).toHaveBeenCalledWith(['run-1', 'run-2']);
  });

  it('shows the comparison as a grid against the baseline', () => {
    const { onCompareChange } = renderRuns({ compare: ['run-1', 'run-2'] });
    const compare = screen.getByTestId('agtEvlCompare');
    expect(within(compare).getByText('Compare runs: travel-suite')).toBeInTheDocument();
    const a = screen.getByTestId('agtEvlRunSummary-A');
    const b = screen.getByTestId('agtEvlRunSummary-B');
    expect(within(a).getByTestId('agtEvlBaselinePill')).toBeInTheDocument();
    expect(within(a).getByTestId('agtEvlChangesReference')).toHaveTextContent('Reference');
    expect(within(b).getByTestId('agtEvlChanges')).toHaveTextContent('↓1 ↑1 of 2');
    expect(within(b).getByTestId('agtEvlRunMean')).toHaveTextContent('0.57');
    // The mean fell 0.08 (more than 5% of 0..1), and nothing rose.
    expect(within(b).getByTestId('agtEvlRunVerdict')).toHaveTextContent('Regression');
    expect(within(b).getByTestId('agtEvlRunVerdictWhy')).toHaveTextContent('Worse on accuracy');
    expect(screen.getByTestId('agtEvlCasesTitle')).toHaveTextContent(
      '2 test cases shared by all runs'
    );
    expect(screen.getByTestId('agtEvlComparability')).toHaveTextContent(
      'The runs cover different test cases: 2 shared · 1 only in B'
    );
    const cases = () =>
      within(screen.getByTestId('agtEvlCompareCases')).getAllByRole('row').slice(1);
    expect(cases()).toHaveLength(3);
    // Biggest regression first.
    expect(cases()[0]).toHaveTextContent('Case b');
    expect(cases()[0]).toHaveTextContent('1 evaluation regressed');
    const delta = within(cases()[0]).getByTestId('agtEvlCellDelta');
    expect(delta).toHaveTextContent('↓70 pp');
    expect(delta).toHaveAttribute('data-change', 'regressed');
    fireEvent.change(screen.getByTestId('agtEvlCaseSort'), { target: { value: 'improvement' } });
    expect(cases()[0]).toHaveTextContent('Case a');
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-regressed'));
    expect(cases()).toHaveLength(1);
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-new'));
    expect(cases()[0]).toHaveTextContent('Case c');
    expect(within(cases()[0]).getByTestId('agtEvlCellMissing')).toBeInTheDocument();
    expect(screen.getAllByTestId('agtEvlRemoveRun')[0]).toBeDisabled();
    fireEvent.click(screen.getByTestId('agtEvlSetBaseline'));
    expect(onCompareChange).toHaveBeenCalledWith(['run-1', 'run-2'], 'run-2');
    fireEvent.click(screen.getByTestId('agtEvlCompareBack'));
    expect(onCompareChange).toHaveBeenCalledWith(undefined);
  });

  it('compares three runs with any of them as the baseline, and removes one', () => {
    const results = [
      ...twoRunFixture(),
      makeResult({
        runId: 'run-3',
        suiteName: 'travel-suite',
        caseId: 'a',
        caseName: 'Case a',
        name: 'accuracy',
        value: 0.1,
        scoreMin: 0,
        scoreMax: 1,
        time: '2026-10-27 10:00:00.000',
      }),
    ];
    const { onCompareChange } = renderRuns({
      results,
      compare: ['run-1', 'run-2', 'run-3'],
      baseline: 'run-2',
    });
    expect(
      within(screen.getByTestId('agtEvlRunSummary-B')).getByTestId('agtEvlBaselinePill')
    ).toBeInTheDocument();
    // run-3 against run-2: case a dropped from 0.8 to 0.1.
    expect(
      within(screen.getByTestId('agtEvlRunSummary-C')).getByTestId('agtEvlChanges')
    ).toHaveTextContent('↓1 ↑0 of 1');
    expect(screen.getByTestId('agtEvlCasesTitle')).toHaveTextContent('1 test case shared');
    expect(screen.getByTestId('agtEvlAddRun')).toBeDisabled();
    fireEvent.click(screen.getAllByTestId('agtEvlRemoveRun')[1]);
    expect(onCompareChange).toHaveBeenCalledWith(['run-1', 'run-3'], 'run-1');
  });

  it('warns when a compared run has no results', () => {
    renderRuns({
      compare: ['run-1', 'gone'],
      compareData: {
        loading: false,
        results: twoRunFixture(),
        events: EMPTY_RUN_EVENTS,
        missing: ['gone'],
      },
    });
    expect(screen.getByTestId('agtEvlCompareMissing')).toHaveTextContent('gone');
  });
});

describe('RunsTab with test case and run events', () => {
  const rows = () => within(screen.getByTestId('agtEvlRunsTable')).getAllByRole('row').slice(1);
  const caseRow = (name: string) => {
    const row = within(screen.getByTestId('agtEvlCompareCases'))
      .getAllByRole('row')
      .find((r) => within(r).queryByText(name));
    if (!row) throw new Error(`no row ${name}`);
    return row;
  };

  it('shows counts, errored cases and duration from the events', () => {
    renderRuns({ events: twoRunEventsFixture() });
    const [latest, first] = rows();
    expect(within(latest).getByText('run-2')).toBeInTheDocument();
    expect(within(latest).getByTestId('agtEvlRunErrored')).toHaveTextContent('Errored');
    expect(within(latest).getByTestId('agtEvlRunErroredCount')).toHaveTextContent('1 errored');
    expect(latest).toHaveTextContent('8.00 s');
    expect(within(first).queryByTestId('agtEvlRunErrored')).not.toBeInTheDocument();
    expect(first).toHaveTextContent('6.00 s');
  });

  it('shows no errored cases and no duration for runs without events', () => {
    renderRuns();
    expect(within(rows()[0]).queryByTestId('agtEvlRunErroredCount')).not.toBeInTheDocument();
    expect(within(rows()[0]).queryByTestId('agtEvlRunErrored')).not.toBeInTheDocument();
    expect(within(rows()[0]).getByTestId('agtEvlRunSplit')).toHaveTextContent('2/3');
  });

  it('compares case status from the events, with the error badge and missing cases', () => {
    renderRuns({ events: twoRunEventsFixture(), compare: ['run-1', 'run-2'] });
    const d = caseRow('Case d');
    expect(within(d).getByTestId('agtEvlCaseChangeLine')).toHaveTextContent('Regressed');
    // Compact in the table: the error type is in the badge's tooltip.
    expect(within(d).getByTestId('agtEvlCaseErrorBadge')).toHaveTextContent(/^Errored$/);
    expect(screen.getByTestId('agtEvlCaseFilter-missing')).toBeInTheDocument();
  });

  it('opens a case side by side with links to both agent traces', () => {
    const { onOpenTrace } = renderRuns({
      events: twoRunEventsFixture(),
      compare: ['run-1', 'run-2'],
    });
    fireEvent.click(within(caseRow('Case a')).getByTestId('agtEvlCompareCaseOpen'));
    const flyout = screen.getByTestId('agtEvlCaseFlyout');
    expect(within(flyout).getByTestId('agtEvlCaseInput')).toHaveTextContent('Plan a trip a');
    expect(within(flyout).getByTestId('agtEvlCaseExpected')).toHaveTextContent('Itinerary a');
    expect(within(flyout).getByTestId('agtEvlCaseOutput-baseline')).toHaveTextContent('old a');
    expect(within(flyout).getByTestId('agtEvlCaseOutput-candidate')).toHaveTextContent('new a');
    expect(within(flyout).getByTestId('agtEvlCaseScores')).toHaveTextContent('accuracy');
    fireEvent.click(within(flyout).getByTestId('agtEvlCaseTrace-candidate'));
    expect(onOpenTrace).toHaveBeenCalledWith(
      'run-2-trace-a',
      Date.parse('2026-10-26T10:00:00.000Z')
    );
    fireEvent.click(within(flyout).getByTestId('agtEvlCaseTrace-baseline'));
    expect(onOpenTrace).toHaveBeenCalledWith(
      'run-1-trace-a',
      Date.parse('2026-10-25T10:00:00.000Z')
    );
  });

  it('opens a grades-only case with a note that content was not recorded', () => {
    const { onOpenTrace } = renderRuns({ compare: ['run-1', 'run-2'] });
    fireEvent.click(within(caseRow('Case a')).getByTestId('agtEvlCompareCaseOpen'));
    const flyout = screen.getByTestId('agtEvlCaseFlyout');
    expect(within(flyout).getByTestId('agtEvlCaseNoContent')).toBeInTheDocument();
    expect(within(flyout).getByTestId('agtEvlCaseInput')).toHaveTextContent('Not recorded');
    fireEvent.click(within(flyout).getByTestId('agtEvlCaseTrace-candidate'));
    expect(onOpenTrace).toHaveBeenCalledTimes(1);
  });
});
