/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/** The judge mark (scales) used wherever a span or trace carries evaluation results. */
export const JudgeIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 12,
  className,
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
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

export type JudgeState = 'fail' | 'error' | 'pass' | 'scored';

/** Red when anything failed, amber for evaluator errors, green when results passed, else gray. */
export const judgeState = (counts: {
  pass: number;
  fail: number;
  error: number;
  neutral: number;
}): JudgeState =>
  counts.fail > 0 ? 'fail' : counts.error > 0 ? 'error' : counts.pass > 0 ? 'pass' : 'scored';

export interface JudgeCounts {
  pass: number;
  fail: number;
  error: number;
  neutral: number;
}

/** `2 failing of 4`, `4 passing`, `1 errored of 3` or `3 scored`: the pill's words. */
export const judgeSummaryText = (counts: JudgeCounts): string => {
  const total = counts.pass + counts.fail + counts.error + counts.neutral;
  if (counts.fail > 0) return `${counts.fail} failing of ${total}`;
  if (counts.error > 0) return `${counts.error} errored of ${total}`;
  if (counts.pass > 0)
    return counts.pass === total ? `${total} passing` : `${counts.pass} passing of ${total}`;
  return `${total} scored`;
};

/** The judge mark with its summary, as one pill: red when anything failed, green when passing. */
export const JudgePill = React.forwardRef<
  HTMLButtonElement,
  {
    counts: JudgeCounts;
    onClick?: () => void;
    'aria-label'?: string;
    'data-test-subj'?: string;
  }
>(({ counts, onClick, ...rest }, ref) => {
  const state = judgeState(counts);
  const content = (
    <>
      <JudgeIcon />
      <span>{judgeSummaryText(counts)}</span>
    </>
  );
  const className = `agtEvlJudgePill agtEvlJudgePill--${state}`;
  const testSubj = rest['data-test-subj'] ?? 'agtEvlJudgePill';
  return onClick ? (
    <button
      ref={ref}
      type="button"
      className={className}
      onClick={onClick}
      aria-label={rest['aria-label']}
      data-test-subj={testSubj}
      data-state={state}
    >
      {content}
    </button>
  ) : (
    <span
      className={className}
      aria-label={rest['aria-label']}
      data-test-subj={testSubj}
      data-state={state}
    >
      {content}
    </span>
  );
});
