/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { JsonAccordion, JsonBlock, isJsonLike } from './json_viewer';

describe('json viewer', () => {
  it('tells JSON from text', () => {
    expect(isJsonLike({ a: 1 })).toBe(true);
    expect(isJsonLike('[1,2]')).toBe(true);
    expect(isJsonLike('{not json')).toBe(false);
    expect(isJsonLike('plain')).toBe(false);
    expect(isJsonLike(undefined)).toBe(false);
  });

  it('pretty prints JSON strings and says when nothing is recorded', () => {
    const { rerender } = render(<JsonBlock value='{"a":1}' testId="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('"a": 1');
    rerender(<JsonBlock value="" testId="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('Not recorded');
  });

  it('builds the value only when the accordion opens', () => {
    const read = jest.fn(() => ({ big: true }));
    render(<JsonAccordion id="j" label="Raw" read={read} testId="acc" />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Raw'));
    expect(read).toHaveBeenCalled();
    expect(screen.getByTestId('acc')).toHaveTextContent('"big": true');
  });
});
