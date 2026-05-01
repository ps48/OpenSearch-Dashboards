/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppState, UseAppStateReturn } from './use_app_state';

// Test harness component that exposes hook state via DOM
const TestHarness: React.FC<{ initial?: any }> = ({ initial }) => {
  const hook = useAppState(initial);
  return (
    <div>
      <span data-test-subj="code">{hook.state.code}</span>
      <span data-test-subj="canUndo">{String(hook.canUndo)}</span>
      <span data-test-subj="canRedo">{String(hook.canRedo)}</span>
      <button data-test-subj="push" onClick={() => hook.pushState({ code: 'pushed' })}>
        push
      </button>
      <button data-test-subj="undo" onClick={() => hook.undo()}>
        undo
      </button>
      <button data-test-subj="redo" onClick={() => hook.redo()}>
        redo
      </button>
      {/* For dynamic push tests */}
      <button
        data-test-subj="pushDynamic"
        onClick={() => {
          const current = parseInt(hook.state.code.replace('v', '') || '0', 10);
          hook.pushState({ code: `v${current + 1}` });
        }}
      >
        pushDynamic
      </button>
    </div>
  );
};

const getCode = () => screen.getByTestId('code').textContent;
const getCanUndo = () => screen.getByTestId('canUndo').textContent === 'true';
const getCanRedo = () => screen.getByTestId('canRedo').textContent === 'true';
const push = () => fireEvent.click(screen.getByTestId('push'));
const pushDynamic = () => fireEvent.click(screen.getByTestId('pushDynamic'));
const undo = () => fireEvent.click(screen.getByTestId('undo'));
const redo = () => fireEvent.click(screen.getByTestId('redo'));

describe('useAppState', () => {
  it('initializes with default state', () => {
    render(<TestHarness />);
    expect(getCode()).toBe('');
    expect(getCanUndo()).toBe(false);
    expect(getCanRedo()).toBe(false);
  });

  it('initializes with provided state', () => {
    render(<TestHarness initial={{ code: 'initial' }} />);
    expect(getCode()).toBe('initial');
  });

  it('pushState updates current state', () => {
    render(<TestHarness />);
    push();
    expect(getCode()).toBe('pushed');
    expect(getCanUndo()).toBe(true);
  });

  it('undo restores previous state', () => {
    render(<TestHarness />);
    pushDynamic(); // v1
    pushDynamic(); // v2
    expect(getCode()).toBe('v2');
    undo();
    expect(getCode()).toBe('v1');
    expect(getCanRedo()).toBe(true);
  });

  it('redo restores undone state', () => {
    render(<TestHarness />);
    pushDynamic(); // v1
    pushDynamic(); // v2
    undo();
    redo();
    expect(getCode()).toBe('v2');
  });

  it('pushState after undo clears redo stack', () => {
    render(<TestHarness />);
    pushDynamic(); // v1
    pushDynamic(); // v2
    undo();
    push(); // new push
    expect(getCanRedo()).toBe(false);
  });

  it('caps history at MAX_HISTORY (20)', () => {
    render(<TestHarness />);
    for (let i = 0; i < 25; i++) {
      pushDynamic();
    }
    // Undo 20 times
    for (let i = 0; i < 20; i++) {
      undo();
    }
    expect(getCanUndo()).toBe(false);
  });

  it('canUndo is false when stack is empty', () => {
    render(<TestHarness />);
    expect(getCanUndo()).toBe(false);
  });

  it('undo with empty stack is a no-op', () => {
    render(<TestHarness initial={{ code: 'initial' }} />);
    undo();
    expect(getCode()).toBe('initial');
  });
});
