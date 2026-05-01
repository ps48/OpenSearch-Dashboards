/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { PromptEntry, DataSourceRef } from '../../common/types';

export interface AppState {
  code: string;
  promptHistory: PromptEntry[];
  dataSourceRefs: DataSourceRef[];
}

export interface UseAppStateReturn {
  state: AppState;
  pushState: (newState: Partial<AppState>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const MAX_HISTORY = 20;

const DEFAULT_STATE: AppState = {
  code: '',
  promptHistory: [],
  dataSourceRefs: [],
};

export function useAppState(initialState?: Partial<AppState>): UseAppStateReturn {
  const [current, setCurrent] = useState<AppState>({ ...DEFAULT_STATE, ...initialState });
  const [undoStack, setUndoStack] = useState<AppState[]>([]);
  const [redoStack, setRedoStack] = useState<AppState[]>([]);

  const pushState = useCallback(
    (partial: Partial<AppState>) => {
      setUndoStack((prev) => {
        const next = [...prev, current];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
      setRedoStack([]);
      setCurrent((prev) => ({ ...prev, ...partial }));
    },
    [current]
  );

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const newStack = [...prev];
      const restored = newStack.pop()!;
      setRedoStack((r) => [...r, current]);
      setCurrent(restored);
      return newStack;
    });
  }, [current]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const newStack = [...prev];
      const restored = newStack.pop()!;
      setUndoStack((u) => [...u, current]);
      setCurrent(restored);
      return newStack;
    });
  }, [current]);

  return {
    state: current,
    pushState,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
