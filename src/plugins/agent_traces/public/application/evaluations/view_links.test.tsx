/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { NewTabViewLink, traceHref } from './view_links';

describe('NewTabViewLink', () => {
  it('is a new tab link with a popout icon when it has a URL', () => {
    const onOpen = jest.fn();
    render(<NewTabViewLink href="https://x/t" onOpen={onOpen} label="View trace" testId="l" />);
    const link = screen.getByTestId('l');
    expect(link).toHaveAttribute('href', 'https://x/t');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.querySelector('[data-euiicon-type="popout"]')).toBeTruthy();
    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens in place without a URL, and is nothing without either', () => {
    const onOpen = jest.fn();
    const { rerender } = render(<NewTabViewLink onOpen={onOpen} label="View" testId="l" button />);
    expect(screen.getByTestId('l')).not.toHaveAttribute('target');
    fireEvent.click(screen.getByTestId('l'));
    expect(onOpen).toHaveBeenCalled();
    rerender(<NewTabViewLink label="View" testId="l" />);
    expect(screen.queryByTestId('l')).not.toBeInTheDocument();
  });

  it('traceHref asks the context for a trace URL', () => {
    const hrefOf = jest.fn(() => 'u');
    expect(traceHref(hrefOf, 't1', 5)).toBe('u');
    expect(hrefOf).toHaveBeenCalledWith({ level: 'trace', traceId: 't1', time: 5 });
    expect(traceHref(undefined, 't1', 5)).toBeUndefined();
  });
});
