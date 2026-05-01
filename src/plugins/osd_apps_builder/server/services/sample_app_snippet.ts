/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

// Short example snippet included in the LLM system prompt as a few-shot reference.
export const SAMPLE_APP_SNIPPET = `
// EXAMPLE: A minimal OSD App component using PPL queries
var React = require('react');
var eui = require('@elastic/eui');

exports.default = function MyApp(props) {
  var api = props.api;
  var useState = React.useState;
  var useEffect = React.useEffect;

  var _data = useState([]);
  var data = _data[0];
  var setData = _data[1];

  var _loading = useState(true);
  var loading = _loading[0];
  var setLoading = _loading[1];

  useEffect(function() {
    api.search({ query: 'source=my-index* | stats count() by status', language: 'PPL' })
      .then(function(response) {
        // PPL API returns { jsonData: [{field1: val, ...}, ...], size: N }
        var rows = response && response.jsonData ? response.jsonData : [];
        setData(rows);
        setLoading(false);
      })
      .catch(function() { setLoading(false); });
  }, [api]);

  if (loading) return React.createElement(eui.EuiLoadingSpinner, { size: 'xl' });

  return React.createElement(eui.EuiPanel, { paddingSize: 'l' },
    React.createElement(eui.EuiTitle, { size: 's' },
      React.createElement('h2', null, 'My App')
    ),
    React.createElement(eui.EuiSpacer, { size: 'm' }),
    React.createElement(eui.EuiBasicTable, {
      items: data,
      columns: [
        { field: 'status', name: 'Status' },
        { field: 'count', name: 'Count' }
      ]
    })
  );
};`;
