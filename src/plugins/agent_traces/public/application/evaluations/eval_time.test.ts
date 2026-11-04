/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import moment from 'moment-timezone';
import { renderHook } from '@testing-library/react';
import { Subject } from 'rxjs';
import type { IUiSettingsClient } from '../../../../../core/public';
import {
  axisTimeFormat,
  formatInZone,
  getEvalTimezone,
  resolveTimezone,
  setEvalTimezone,
  useEvalTimezone,
} from './eval_time';
import { formatDay, formatTime } from './eval_components';

const T = Date.UTC(2026, 9, 28, 21, 45);
const initial = getEvalTimezone();

describe('evaluation times', () => {
  afterEach(() => setEvalTimezone(initial));

  it('resolves dateFormat:tz: a known zone, else the browser zone', () => {
    const browser = moment.tz.guess() || 'UTC';
    expect(resolveTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(resolveTimezone('Browser')).toBe(browser);
    expect(resolveTimezone(undefined)).toBe(browser);
    expect(resolveTimezone('Not/AZone')).toBe(browser);
  });

  it('formatTime and formatDay follow the set zone', () => {
    setEvalTimezone('UTC');
    expect(getEvalTimezone()).toBe('UTC');
    expect(formatTime(T)).toBe('Oct 28, 21:45');
    expect(formatDay(T)).toBe('Oct 28');
    setEvalTimezone('Asia/Kolkata');
    // UTC+5:30: past midnight, the next day.
    expect(formatTime(T)).toBe('Oct 29, 03:15');
    expect(formatDay(T)).toBe('Oct 29');
    expect(formatInZone(T, 'HH:mm z')).toBe('03:15 IST');
    expect(formatTime(NaN)).toBe('—');
  });

  it('useEvalTimezone applies dateFormat:tz before the first render and follows changes', () => {
    const changes = new Subject<string>();
    const uiSettings = {
      get: jest.fn(() => 'America/New_York'),
      get$: jest.fn(() => changes),
    };
    const { unmount } = renderHook(() =>
      useEvalTimezone(uiSettings as unknown as IUiSettingsClient)
    );
    expect(uiSettings.get).toHaveBeenCalledWith('dateFormat:tz');
    expect(getEvalTimezone()).toBe('America/New_York');
    changes.next('Asia/Kolkata');
    expect(getEvalTimezone()).toBe('Asia/Kolkata');
    changes.next('Browser');
    expect(getEvalTimezone()).toBe(resolveTimezone('Browser'));
    unmount();
    // Unsubscribed on unmount.
    changes.next('Asia/Kolkata');
    expect(getEvalTimezone()).toBe(resolveTimezone('Browser'));
  });

  it('useEvalTimezone without uiSettings keeps the zone', () => {
    setEvalTimezone('UTC');
    renderHook(() => useEvalTimezone(undefined));
    expect(getEvalTimezone()).toBe('UTC');
  });

  it('picks chart axis labels by the span shown', () => {
    expect(axisTimeFormat(3600e3)).toBe('HH:mm');
    expect(axisTimeFormat(24 * 3600e3)).toBe('MMM D HH:mm');
    expect(axisTimeFormat(7 * 24 * 3600e3)).toBe('MMM D');
  });
});
