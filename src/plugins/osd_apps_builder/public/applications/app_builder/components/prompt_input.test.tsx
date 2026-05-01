/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptInput } from './prompt_input';

describe('PromptInput', () => {
  const mockOnSubmit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls onSubmit when button is clicked', () => {
    render(<PromptInput onSubmit={mockOnSubmit} isGenerating={false} />);
    const input = screen.getByTestId('osdAppsPromptInput');
    fireEvent.change(input, { target: { value: 'Build a dashboard' } });
    fireEvent.click(screen.getByTestId('osdAppsPromptSubmit'));
    expect(mockOnSubmit).toHaveBeenCalledWith('Build a dashboard');
  });

  it('calls onSubmit on Enter key (without Shift)', () => {
    render(<PromptInput onSubmit={mockOnSubmit} isGenerating={false} />);
    const input = screen.getByTestId('osdAppsPromptInput');
    fireEvent.change(input, { target: { value: 'Build a chart' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    expect(mockOnSubmit).toHaveBeenCalledWith('Build a chart');
  });

  it('does not submit on Shift+Enter', () => {
    render(<PromptInput onSubmit={mockOnSubmit} isGenerating={false} />);
    const input = screen.getByTestId('osdAppsPromptInput');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('disables input and button when isGenerating is true', () => {
    render(<PromptInput onSubmit={mockOnSubmit} isGenerating={true} />);
    expect(screen.getByTestId('osdAppsPromptInput')).toBeDisabled();
    expect(screen.getByTestId('osdAppsPromptSubmit')).toBeDisabled();
  });

  it('does not submit when input is empty', () => {
    render(<PromptInput onSubmit={mockOnSubmit} isGenerating={false} />);
    fireEvent.click(screen.getByTestId('osdAppsPromptSubmit'));
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });
});
