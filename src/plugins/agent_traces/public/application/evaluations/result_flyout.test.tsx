/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { ResultFlyout, scalePosition } from './result_flyout';
import { recordToResult } from './eval_model';

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
      evaluation: {
        level: 'span',
        score: { min: 0, max: 1 },
        evaluator: { name: 'helpfulness_judge', type: 'llm_judge' },
      },
    },
    test: {
      suite: { name: 'golden', run: { id: 'run_20261028_abcd1234' } },
      case: { id: 'c1', name: 'Case 1' },
    },
  },
});

const renderFlyout = (r = offline, links = {}) =>
  render(
    <I18nProvider>
      <ResultFlyout result={r} onClose={jest.fn()} links={links} />
    </I18nProvider>
  );

describe('ResultFlyout', () => {
  it('shows verdict, score on its scale, label, explanation, evaluator and the raw event', () => {
    renderFlyout();
    expect(screen.getByText('helpfulness')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlVerdict-fail')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlFlyoutScore')).toHaveTextContent('0.40 / 1');
    expect(screen.getByTestId('agtEvlFlyoutScale')).toBeInTheDocument();
    expect(screen.getByText('Vague.')).toBeInTheDocument();
    expect(screen.getByText('helpfulness_judge')).toBeInTheDocument();
    expect(screen.getByText('llm_judge')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlFlyoutJudged')).toHaveTextContent('Span span1');
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
    expect(links.openRun).toHaveBeenCalledWith('run_20261028_abcd1234');
    expect(screen.getByTestId('agtEvlFlyoutSuiteRun')).toHaveTextContent('case Case 1 (c1)');
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
    expect(screen.getByTestId('agtEvlFlyoutJudged')).toHaveTextContent('Whole trace');
    expect(screen.getByText('Online (live traffic)')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlFlyoutScale')).not.toBeInTheDocument();
  });

  it('places a score on its declared scale', () => {
    expect(scalePosition({ value: 4, scoreMin: 1, scoreMax: 5 })).toBe(0.75);
    expect(scalePosition({ value: 4 })).toBeUndefined();
    expect(scalePosition({ value: 9, scoreMin: 0, scoreMax: 5 })).toBe(1);
  });
});
