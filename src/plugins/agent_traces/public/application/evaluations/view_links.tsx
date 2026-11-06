/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EuiButtonEmpty, EuiLink } from '@elastic/eui';
import type { EvalResult } from './eval_model';

/** A URL (for a new tab) to a trace in Agent Traces, from the context's `hrefOf`. */
export const traceHref = (
  hrefOf: ((r: EvalResult) => string | undefined) | undefined,
  traceId: string,
  aroundMs: number
): string | undefined => hrefOf?.({ level: 'trace', traceId, time: aroundMs } as EvalResult);

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * "View trace" / "View session": a real link that opens Agent Traces in a new tab, the popout
 * icon after its label. Without a URL (no `hrefOf`), it opens in place with `onOpen`.
 */
export const NewTabViewLink: React.FC<{
  href?: string;
  onOpen?: () => void;
  label: string;
  /** A small empty button (table rows) rather than an inline link. */
  button?: boolean;
  testId?: string;
}> = ({ href, onOpen, label, button, testId }) => {
  if (!href && !onOpen) return null;
  const tab = href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {};
  const onClick = (e: React.MouseEvent) => {
    stop(e);
    if (!href) onOpen?.();
  };
  if (button) {
    return (
      <EuiButtonEmpty
        size="xs"
        {...tab}
        onClick={onClick}
        iconType={href ? 'popout' : undefined}
        iconSide="right"
        data-test-subj={testId}
      >
        {label}
      </EuiButtonEmpty>
    );
  }
  return (
    // EuiLink adds its own popout icon (and screen reader text) for target="_blank".
    <EuiLink {...tab} onClick={onClick} data-test-subj={testId}>
      {label}
    </EuiLink>
  );
};
