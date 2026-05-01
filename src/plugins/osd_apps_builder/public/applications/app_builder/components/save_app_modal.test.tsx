/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveAppModal } from './save_app_modal';

describe('SaveAppModal', () => {
  const mockOnSave = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders form fields', () => {
    render(<SaveAppModal onSave={mockOnSave} onClose={mockOnClose} />);
    expect(screen.getByTestId('osdAppsSaveTitle')).toBeInTheDocument();
    expect(screen.getByTestId('osdAppsSaveDescription')).toBeInTheDocument();
    expect(screen.getByTestId('osdAppsSaveConfirm')).toBeInTheDocument();
  });

  it('calls onSave with title, description, and tags', () => {
    render(<SaveAppModal onSave={mockOnSave} onClose={mockOnClose} />);
    fireEvent.change(screen.getByTestId('osdAppsSaveTitle'), {
      target: { value: 'My App' },
    });
    fireEvent.change(screen.getByTestId('osdAppsSaveDescription'), {
      target: { value: 'A description' },
    });
    fireEvent.click(screen.getByTestId('osdAppsSaveConfirm'));
    expect(mockOnSave).toHaveBeenCalledWith('My App', 'A description', []);
  });

  it('disables save button when title is empty', () => {
    render(<SaveAppModal onSave={mockOnSave} onClose={mockOnClose} />);
    expect(screen.getByTestId('osdAppsSaveConfirm')).toBeDisabled();
  });

  it('pre-fills initial values', () => {
    render(
      <SaveAppModal
        onSave={mockOnSave}
        onClose={mockOnClose}
        initialTitle="Existing"
        initialDescription="Desc"
        initialTags={['tag1']}
      />
    );
    expect(screen.getByTestId('osdAppsSaveTitle')).toHaveValue('Existing');
    expect(screen.getByTestId('osdAppsSaveDescription')).toHaveValue('Desc');
  });

  it('calls onClose when cancel is clicked', () => {
    render(<SaveAppModal onSave={mockOnSave} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });
});
