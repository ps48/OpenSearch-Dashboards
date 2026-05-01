/* eslint-disable */
/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const React = require('react');
const eui = require('@elastic/eui');

exports.default = function SearchForm(props) {
  const api = props.api;
  const useState = React.useState;
  const useCallback = React.useCallback;

  const _query = useState('');
  const query = _query[0];
  const setQuery = _query[1];

  const _results = useState([]);
  const results = _results[0];
  const setResults = _results[1];

  const _loading = useState(false);
  const loading = _loading[0];
  const setLoading = _loading[1];

  const _totalHits = useState(0);
  const totalHits = _totalHits[0];
  const setTotalHits = _totalHits[1];

  const _pageIndex = useState(0);
  const pageIndex = _pageIndex[0];
  const setPageIndex = _pageIndex[1];

  const _pageSize = useState(10);
  const pageSize = _pageSize[0];
  const setPageSize = _pageSize[1];

  const handleSearch = useCallback(
    function () {
      if (!query.trim()) return;
      setLoading(true);
      const pplQuery = 'source=logs-otel-v1* | where message like "' + query + '" | head 100';
      api
        .search({ query: pplQuery, language: 'PPL' })
        .then(function (response) {
          const hits =
            response && response.rawResponse && response.rawResponse.hits
              ? response.rawResponse.hits.hits.map(function (hit, idx) {
                  return { ...{ _id: hit._id || String(idx) }, ...hit._source };
                })
              : [];
          setResults(hits);
          setTotalHits(hits.length);
          setPageIndex(0);
          setLoading(false);
        })
        .catch(function () {
          setResults([]);
          setTotalHits(0);
          setLoading(false);
        });
    },
    [api, query]
  );

  const pagedResults = results.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const columns = [
    {
      field: '@timestamp',
      name: 'Timestamp',
      width: '180px',
      sortable: true,
      render: function (ts) {
        return React.createElement(
          eui.EuiText,
          { size: 'xs' },
          ts ? new Date(ts).toLocaleString() : '-'
        );
      },
    },
    {
      field: 'service.name',
      name: 'Service',
      width: '150px',
      render: function (name) {
        return name
          ? React.createElement(eui.EuiBadge, { color: 'hollow' }, name)
          : React.createElement(eui.EuiText, { size: 'xs', color: 'subdued' }, '-');
      },
    },
    {
      field: 'message',
      name: 'Message',
      truncateText: true,
    },
  ];

  return React.createElement(
    eui.EuiPanel,
    { paddingSize: 'l', style: { height: '100%', overflowY: 'auto' } },
    React.createElement(
      eui.EuiTitle,
      { size: 's' },
      React.createElement('h2', null, 'Document Search')
    ),
    React.createElement(eui.EuiSpacer, { size: 'm' }),

    // Search bar
    React.createElement(
      eui.EuiFlexGroup,
      { gutterSize: 's' },
      React.createElement(
        eui.EuiFlexItem,
        null,
        React.createElement(eui.EuiFieldSearch, {
          placeholder: 'Search documents...',
          value: query,
          onChange: function (e) {
            setQuery(e.target.value);
          },
          onSearch: handleSearch,
          isClearable: true,
          fullWidth: true,
        })
      ),
      React.createElement(
        eui.EuiFlexItem,
        { grow: false },
        React.createElement(
          eui.EuiButton,
          {
            fill: true,
            onClick: handleSearch,
            isLoading: loading,
            disabled: !query.trim(),
          },
          'Search'
        )
      )
    ),
    React.createElement(eui.EuiSpacer, { size: 'm' }),

    // Results count
    totalHits > 0 &&
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          eui.EuiText,
          { size: 's', color: 'subdued' },
          'Found ' + totalHits + ' results'
        ),
        React.createElement(eui.EuiSpacer, { size: 's' })
      ),

    // Results or empty state
    results.length === 0 && !loading
      ? React.createElement(eui.EuiEmptyPrompt, {
          iconType: 'search',
          title: React.createElement('h3', null, 'Search your data'),
          body: React.createElement('p', null, 'Enter a search term above to find documents.'),
        })
      : React.createElement(eui.EuiBasicTable, {
          items: pagedResults,
          columns: columns,
          loading: loading,
          pagination: {
            pageIndex: pageIndex,
            pageSize: pageSize,
            totalItemCount: totalHits,
            pageSizeOptions: [10, 25, 50],
          },
          onChange: function (criteria) {
            if (criteria.page) {
              setPageIndex(criteria.page.index);
              setPageSize(criteria.page.size);
            }
          },
        })
  );
};
