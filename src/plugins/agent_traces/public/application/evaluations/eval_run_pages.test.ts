/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { SUITE_HISTORY_MS, suiteHistoryBounds } from './eval_run_pages';

describe('suiteHistoryBounds', () => {
  const now = Date.UTC(2026, 9, 30);
  it('reads the suite from 30 days before the earliest run to now', () => {
    const a = Date.UTC(2026, 8, 1);
    const b = Date.UTC(2026, 8, 10);
    expect(suiteHistoryBounds([b, a], now)).toEqual({ from: a - SUITE_HISTORY_MS, to: now });
  });
  it('waits for a known start', () => {
    expect(suiteHistoryBounds([], now)).toBeUndefined();
    expect(suiteHistoryBounds([NaN, 0], now)).toBeUndefined();
  });
});
