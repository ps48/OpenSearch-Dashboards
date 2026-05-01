/* eslint-disable */
/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const React = require('react');
const eui = require('@elastic/eui');

exports.default = function LogViewer(props) {
  const api = props.api;
  const useState = React.useState;
  const useEffect = React.useEffect;
  const useCallback = React.useCallback;

  const _logs = useState([]);
  const logs = _logs[0];
  const setLogs = _logs[1];

  const _loading = useState(false);
  const loading = _loading[0];
  const setLoading = _loading[1];

  const _searchQuery = useState('');
  const searchQuery = _searchQuery[0];
  const setSearchQuery = _searchQuery[1];

  const _severityFilter = useState('all');
  const severityFilter = _severityFilter[0];
  const setSeverityFilter = _severityFilter[1];

  const fetchLogs = useCallback(
    function () {
      setLoading(true);
      let query = 'source=logs-otel-v1* | sort @timestamp desc | head 100';
      if (searchQuery) {
        query =
          'source=logs-otel-v1* | where message like "' +
          searchQuery +
          '" | sort @timestamp desc | head 100';
      }
      api
        .search({ query: query, language: 'PPL' })
        .then(function (response) {
          const hits =
            response && response.rawResponse && response.rawResponse.hits
              ? response.rawResponse.hits.hits.map(function (hit) {
                  return hit._source;
                })
              : [];
          setLogs(hits);
          setLoading(false);
        })
        .catch(function () {
          setLogs([]);
          setLoading(false);
        });
    },
    [api, searchQuery]
  );

  useEffect(
    function () {
      fetchLogs();
    },
    [fetchLogs]
  );

  const getSeverityColor = function (severity) {
    if (severity === 'ERROR' || severity === 'FATAL') return 'danger';
    if (severity === 'WARN' || severity === 'WARNING') return 'warning';
    if (severity === 'INFO') return 'primary';
    return 'default';
  };

  const filteredLogs =
    severityFilter === 'all'
      ? logs
      : logs.filter(function (log) {
          return (log.severity || log.level || '').toUpperCase() === severityFilter;
        });

  const columns = [
    {
      field: '@timestamp',
      name: 'Timestamp',
      sortable: true,
      width: '200px',
      render: function (ts) {
        return React.createElement(
          eui.EuiText,
          { size: 'xs' },
          ts ? new Date(ts).toLocaleString() : '-'
        );
      },
    },
    {
      field: 'severity',
      name: 'Severity',
      width: '100px',
      render: function (sev) {
        const level = (sev || 'INFO').toUpperCase();
        return React.createElement(eui.EuiBadge, { color: getSeverityColor(level) }, level);
      },
    },
    {
      field: 'message',
      name: 'Message',
      truncateText: false,
      render: function (msg) {
        return React.createElement(eui.EuiText, { size: 's' }, msg || '-');
      },
    },
  ];

  const severityOptions = [
    { value: 'all', text: 'All Severities' },
    { value: 'ERROR', text: 'Error' },
    { value: 'WARN', text: 'Warning' },
    { value: 'INFO', text: 'Info' },
    { value: 'DEBUG', text: 'Debug' },
  ];

  return React.createElement(
    eui.EuiPanel,
    { paddingSize: 'l', style: { height: '100%' } },
    React.createElement(
      eui.EuiFlexGroup,
      { alignItems: 'center', gutterSize: 'm' },
      React.createElement(
        eui.EuiFlexItem,
        null,
        React.createElement(
          eui.EuiTitle,
          { size: 's' },
          React.createElement('h2', null, 'Log Viewer')
        )
      ),
      React.createElement(
        eui.EuiFlexItem,
        { grow: false },
        React.createElement(
          eui.EuiButtonEmpty,
          { iconType: 'refresh', onClick: fetchLogs, size: 's' },
          'Refresh'
        )
      )
    ),
    React.createElement(eui.EuiSpacer, { size: 'm' }),
    React.createElement(
      eui.EuiFlexGroup,
      { gutterSize: 'm' },
      React.createElement(
        eui.EuiFlexItem,
        null,
        React.createElement(eui.EuiFieldSearch, {
          placeholder: 'Search logs...',
          value: searchQuery,
          onChange: function (e) {
            setSearchQuery(e.target.value);
          },
          onSearch: fetchLogs,
          isClearable: true,
        })
      ),
      React.createElement(
        eui.EuiFlexItem,
        { grow: false },
        React.createElement(eui.EuiSelect, {
          options: severityOptions,
          value: severityFilter,
          onChange: function (e) {
            setSeverityFilter(e.target.value);
          },
        })
      )
    ),
    React.createElement(eui.EuiSpacer, { size: 'm' }),
    React.createElement(
      eui.EuiText,
      { size: 'xs', color: 'subdued' },
      'Showing ' +
        filteredLogs.length +
        ' logs' +
        (searchQuery ? ' matching "' + searchQuery + '"' : '')
    ),
    React.createElement(eui.EuiSpacer, { size: 's' }),
    loading
      ? React.createElement(eui.EuiLoadingSpinner, { size: 'xl' })
      : React.createElement(eui.EuiBasicTable, {
          items: filteredLogs,
          columns: columns,
          pagination: { initialPageSize: 25, pageSizeOptions: [10, 25, 50] },
          sorting: { sort: { field: '@timestamp', direction: 'desc' } },
        })
  );
};
