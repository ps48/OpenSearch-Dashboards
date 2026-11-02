/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EuiToolTip } from '@elastic/eui';
import { EvalResult, Tally, tallyOf } from './eval_model';
import { VERDICT_LABEL } from './eval_components';

/** The judge mark (scales) on spans and traces that carry evaluation results. */
export const JudgeIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    data-test-subj="agtEvlJudgeIcon"
  >
    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
    <path d="M7 21h10" />
    <path d="M12 3v18" />
    <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
  </svg>
);

export type JudgeState = 'fail' | 'mixed' | 'error' | 'pass' | 'scored';

/** Red when everything judged failed, mixed with passes, amber for errors, green, else gray. */
export const judgeState = (t: Tally): JudgeState =>
  t.fail > 0
    ? t.pass > 0
      ? 'mixed'
      : 'fail'
    : t.error > 0
      ? 'error'
      : t.pass > 0
        ? 'pass'
        : 'scored';

/** The mark, colored by the results' verdicts; hover lists them. */
export const JudgeMark: React.FC<{ results: EvalResult[] }> = ({ results }) => {
  if (!results.length) return null;
  const state = judgeState(tallyOf(results));
  return (
    <EuiToolTip
      content={
        <span>
          {results.map((r) => (
            <span key={r.id} className="agtEvlJudgeTip">
              {r.name}: {VERDICT_LABEL[r.verdict]}
            </span>
          ))}
        </span>
      }
    >
      <span
        className={`agtEvlJudge agtEvlJudge--${state}`}
        data-test-subj="agtEvlJudgeMark"
        data-state={state}
      >
        <JudgeIcon />
      </span>
    </EuiToolTip>
  );
};
