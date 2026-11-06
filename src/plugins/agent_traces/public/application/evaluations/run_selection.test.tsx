/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { NOT_COMPARABLE_TIP, NO_SUITE_TIP, TWO_PICKED_TIP, useRunSelection } from './run_selection';

interface Run {
  runId: string;
  suite?: string;
  agent?: string;
  started: number;
}
const run = (runId: string, suite?: string, agent?: string): Run => ({
  runId,
  suite,
  agent,
  started: 0,
});

describe('useRunSelection', () => {
  it('blocks runs of another suite or agent, and runs without a suite', () => {
    const { result } = renderHook(() => useRunSelection<Run>());
    act(() => result.current.toggle(run('a', 'g', 'tp')));
    expect(result.current.blockedReason(run('b', 'g', 'tp'))).toBeUndefined();
    expect(result.current.blockedReason(run('c', 'g', 'bot'))).toBe(NOT_COMPARABLE_TIP);
    expect(result.current.blockedReason(run('d', 'other', 'tp'))).toBe(NOT_COMPARABLE_TIP);
    act(() => result.current.toggle(run('b', 'g', 'tp')));
    expect(result.current.blockedReason(run('e', 'g', 'tp'))).toBe(TWO_PICKED_TIP);
  });

  it('blocks runs without a suite from the first pick, so Compare is never out of reach', () => {
    const { result } = renderHook(() => useRunSelection<Run>());
    expect(result.current.blockedReason(run('a'))).toBe(NO_SUITE_TIP);
    expect(result.current.blockedReason(run('b', 'g', 'tp'))).toBeUndefined();
    act(() => result.current.toggle(run('b', 'g', 'tp')));
    expect(result.current.blockedReason(run('c'))).toBe(NO_SUITE_TIP);
  });

  it('drops picked runs the table no longer lists, and keeps them while loading', () => {
    const a = run('a', 'g', 'tp');
    const b = run('b', 'g', 'tp');
    const { result, rerender } = renderHook(({ visible }) => useRunSelection<Run>(visible), {
      initialProps: { visible: [a, b] as Run[] | undefined },
    });
    act(() => result.current.toggle(a));
    act(() => result.current.toggle(b));
    rerender({ visible: undefined });
    expect(result.current.selected).toHaveLength(2);
    rerender({ visible: [b] });
    expect(result.current.selected.map((r) => r.runId)).toEqual(['b']);
  });
});
