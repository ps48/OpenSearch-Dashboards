/* eslint-disable */
/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const React = require('react');
const eui = require('@elastic/eui');

exports.default = function MetricsDashboard(props) {
  const api = props.api;
  const useState = React.useState;
  const useEffect = React.useEffect;

  const _metrics = useState({ totalRequests: 0, errorRate: 0, avgLatency: 0, p99Latency: 0 });
  const metrics = _metrics[0];
  const setMetrics = _metrics[1];

  const _latencyData = useState([]);
  const latencyData = _latencyData[0];
  const setLatencyData = _latencyData[1];

  const _loading = useState(true);
  const loading = _loading[0];
  const setLoading = _loading[1];

  useEffect(function () {
    setLoading(true);
    // Simulate metrics from search results
    const sampleLatency = [];
    for (let i = 0; i < 24; i++) {
      sampleLatency.push({
        hour: i + ':00',
        avg: Math.floor(Math.random() * 200) + 50,
        p99: Math.floor(Math.random() * 500) + 200,
      });
    }
    setLatencyData(sampleLatency);
    setMetrics({
      totalRequests: 125430,
      errorRate: 2.3,
      avgLatency: 145,
      p99Latency: 487,
    });
    setLoading(false);
  }, []);

  if (loading) {
    return React.createElement(eui.EuiLoadingSpinner, { size: 'xl' });
  }

  return React.createElement(
    eui.EuiPanel,
    { paddingSize: 'l', style: { height: '100%', overflowY: 'auto' } },
    React.createElement(
      eui.EuiTitle,
      { size: 's' },
      React.createElement('h2', null, 'Service Metrics Dashboard')
    ),
    React.createElement(eui.EuiSpacer, { size: 'm' }),

    // Stat cards row
    React.createElement(
      eui.EuiFlexGroup,
      { gutterSize: 'l' },
      React.createElement(
        eui.EuiFlexItem,
        null,
        React.createElement(
          eui.EuiPanel,
          { paddingSize: 'm', hasBorder: true },
          React.createElement(eui.EuiStat, {
            title: metrics.totalRequests.toLocaleString(),
            description: 'Total Requests',
            titleColor: 'primary',
          })
        )
      ),
      React.createElement(
        eui.EuiFlexItem,
        null,
        React.createElement(
          eui.EuiPanel,
          { paddingSize: 'm', hasBorder: true },
          React.createElement(eui.EuiStat, {
            title: metrics.errorRate + '%',
            description: 'Error Rate',
            titleColor: metrics.errorRate > 5 ? 'danger' : 'secondary',
          })
        )
      ),
      React.createElement(
        eui.EuiFlexItem,
        null,
        React.createElement(
          eui.EuiPanel,
          { paddingSize: 'm', hasBorder: true },
          React.createElement(eui.EuiStat, {
            title: metrics.avgLatency + 'ms',
            description: 'Avg Latency',
            titleColor: 'primary',
          })
        )
      ),
      React.createElement(
        eui.EuiFlexItem,
        null,
        React.createElement(
          eui.EuiPanel,
          { paddingSize: 'm', hasBorder: true },
          React.createElement(eui.EuiStat, {
            title: metrics.p99Latency + 'ms',
            description: 'P99 Latency',
            titleColor: metrics.p99Latency > 500 ? 'danger' : 'primary',
          })
        )
      )
    ),
    React.createElement(eui.EuiSpacer, { size: 'l' }),

    // Latency table
    React.createElement(
      eui.EuiTitle,
      { size: 'xs' },
      React.createElement('h3', null, 'Hourly Latency Breakdown')
    ),
    React.createElement(eui.EuiSpacer, { size: 's' }),
    React.createElement(eui.EuiBasicTable, {
      items: latencyData,
      columns: [
        { field: 'hour', name: 'Hour', width: '100px' },
        {
          field: 'avg',
          name: 'Avg Latency (ms)',
          render: function (val) {
            return React.createElement(
              eui.EuiFlexGroup,
              { alignItems: 'center', gutterSize: 's' },
              React.createElement(
                eui.EuiFlexItem,
                { grow: false },
                React.createElement('span', null, val + 'ms')
              ),
              React.createElement(
                eui.EuiFlexItem,
                null,
                React.createElement('div', {
                  style: {
                    width: Math.min(val / 3, 100) + '%',
                    height: '8px',
                    backgroundColor: val > 200 ? '#BD271E' : '#006BB4',
                    borderRadius: '4px',
                  },
                })
              )
            );
          },
        },
        {
          field: 'p99',
          name: 'P99 Latency (ms)',
          render: function (val) {
            return React.createElement(
              eui.EuiBadge,
              {
                color: val > 500 ? 'danger' : val > 300 ? 'warning' : 'default',
              },
              val + 'ms'
            );
          },
        },
      ],
      pagination: { initialPageSize: 12, pageSizeOptions: [12, 24] },
    })
  );
};
