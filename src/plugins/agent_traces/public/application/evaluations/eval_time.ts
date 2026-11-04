/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import moment from 'moment-timezone';
import { useEffect, useState } from 'react';
import { IUiSettingsClient } from '../../../../../core/public';

/**
 * Times in the evaluations views: PPL returns UTC without a zone (parsed as UTC in
 * `parseTime`); they are shown in the user's `dateFormat:tz`, as Discover and Agent Traces do
 * ("Browser" or unset: the browser's zone).
 */
export const resolveTimezone = (tz?: string): string => {
  if (tz && tz !== 'Browser' && moment.tz.zone(tz)) return tz;
  return moment.tz.guess() || 'UTC';
};

let timezone = resolveTimezone();

export const getEvalTimezone = () => timezone;

export const setEvalTimezone = (tz?: string) => {
  timezone = resolveTimezone(tz);
};

/** A time (epoch ms) in UTC: the day and week buckets of the PPL `span()`. */
export const formatInUtc = (ms: number, format: string) => moment.utc(ms).format(format);

/** A time (epoch ms) in the user's zone. */
export const formatInZone = (ms: number, format: string) => moment.tz(ms, timezone).format(format);

/**
 * Follows `dateFormat:tz` while mounted (the first value applies before the first render).
 * Returns the zone: a change re-renders the caller, which passes it on (the Evaluations app
 * puts it in its screen context), so the screens format times in the new zone.
 */
export const useEvalTimezone = (uiSettings?: IUiSettingsClient): string => {
  const [zone, setZone] = useState(() => {
    if (uiSettings) setEvalTimezone(uiSettings.get('dateFormat:tz'));
    return getEvalTimezone();
  });
  useEffect(() => {
    if (!uiSettings) return;
    const subscription = uiSettings.get$<string>('dateFormat:tz').subscribe((tz) => {
      setEvalTimezone(tz);
      setZone(getEvalTimezone());
    });
    return () => subscription.unsubscribe();
  }, [uiSettings]);
  return zone;
};

/** Chart axis labels for a time span (ms), in the user's zone. */
export const axisTimeFormat = (spanMs: number) =>
  spanMs >= 3 * 24 * 3600e3 ? 'MMM D' : spanMs >= 24 * 3600e3 ? 'MMM D HH:mm' : 'HH:mm';
