/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from '@testing-library/react';
import { PassRateChart } from './pass_rate_chart';

const mockSettingsProps: Array<Record<string, any>> = [];

jest.mock('@elastic/charts', () => {
  const actual = jest.requireActual('@elastic/charts');
  const Stub: React.FC = ({ children }) => <div>{children}</div>;
  return {
    ...actual,
    Chart: Stub,
    Axis: () => null,
    LineSeries: () => null,
    LineAnnotation: () => null,
    Settings: (props: Record<string, any>) => {
      mockSettingsProps.push(props);
      return null;
    },
  };
});

const mockSetTime = jest.fn();
jest.mock('../../../../opensearch_dashboards_react/public', () => ({
  useOpenSearchDashboards: () => ({
    services: { data: { query: { timefilter: { timefilter: { setTime: mockSetTime } } } } },
  }),
}));

const lastSettings = () => mockSettingsProps[mockSettingsProps.length - 1];

describe('PassRateChart', () => {
  beforeEach(() => {
    mockSettingsProps.length = 0;
    mockSetTime.mockClear();
  });

  const points = [
    { t: Date.UTC(2026, 9, 28), rate: 0.5 },
    { t: Date.UTC(2026, 9, 29), rate: 0.75 },
  ];

  it('sets the global time range to a brushed selection', () => {
    render(<PassRateChart id="c" points={points} />);
    lastSettings().onBrushEnd({ x: [Date.UTC(2026, 9, 28, 6), Date.UTC(2026, 9, 28, 18)] });
    expect(mockSetTime).toHaveBeenCalledWith({
      from: '2026-10-28T06:00:00.000Z',
      to: '2026-10-28T18:00:00.000Z',
    });
  });

  it('ignores an empty or zero-width brush', () => {
    render(<PassRateChart id="c" points={points} />);
    lastSettings().onBrushEnd({});
    lastSettings().onBrushEnd({ x: [5, 5] });
    expect(mockSetTime).not.toHaveBeenCalled();
  });
});
