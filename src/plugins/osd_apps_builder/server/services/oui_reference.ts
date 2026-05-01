/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

// NOTE: OSD uses @elastic/eui as the import alias but the underlying implementation is OUI (OpenSearch UI).
// All imports use: var eui = require('@elastic/eui');

export const OUI_REFERENCE: Record<string, string> = {
  overview: `# OUI Component Reference (imported as @elastic/eui)
var eui = require('@elastic/eui');

Available categories: layout, data-display, forms, charts, navigation, feedback
Use get_oui_components with a category name for detailed examples.`,

  layout: `# Layout Components
var eui = require('@elastic/eui');

// Page layout
React.createElement(eui.EuiPage, { paddingSize: 'l' },
  React.createElement(eui.EuiPageBody, null, content)
)

// Flex layout (horizontal)
React.createElement(eui.EuiFlexGroup, { gutterSize: 'm', alignItems: 'center' },
  React.createElement(eui.EuiFlexItem, { grow: false }, child1),
  React.createElement(eui.EuiFlexItem, null, child2)
)

// Flex layout (vertical)
React.createElement(eui.EuiFlexGroup, { direction: 'column' }, items)

// Panel with border
React.createElement(eui.EuiPanel, { paddingSize: 'm', hasBorder: true }, content)

// Spacer
React.createElement(eui.EuiSpacer, { size: 'm' })  // xs, s, m, l, xl

// Horizontal rule
React.createElement(eui.EuiHorizontalRule, null)

// Resizable split pane
React.createElement(eui.EuiResizableContainer, null,
  function(EuiResizablePanel, EuiResizableButton) {
    return [
      React.createElement(EuiResizablePanel, { initialSize: 30, minSize: '200px' }, leftContent),
      React.createElement(EuiResizableButton, null),
      React.createElement(EuiResizablePanel, { initialSize: 70, minSize: '400px' }, rightContent)
    ];
  }
)

// Title
React.createElement(eui.EuiTitle, { size: 's' },  // xs, s, m, l
  React.createElement('h2', null, 'My Title')
)`,

  'data-display': `# Data Display Components
var eui = require('@elastic/eui');

// Basic table with columns
React.createElement(eui.EuiBasicTable, {
  items: data,
  columns: [
    { field: 'name', name: 'Name', sortable: true },
    { field: 'status', name: 'Status', width: '100px',
      render: function(val) { return React.createElement(eui.EuiBadge, { color: val === 'ERROR' ? 'danger' : 'default' }, val); }
    },
    { field: 'count', name: 'Count', render: function(v) { return v.toLocaleString(); } }
  ],
  pagination: { initialPageSize: 10, pageSizeOptions: [10, 25, 50] },
  sorting: { sort: { field: 'name', direction: 'asc' } }
})

// In-memory table (built-in search + filtering)
React.createElement(eui.EuiInMemoryTable, {
  items: data,
  columns: columns,
  search: { box: { incremental: true } },
  pagination: { initialPageSize: 20 },
  sorting: true
})

// Stat card
React.createElement(eui.EuiStat, {
  title: '1,234',
  description: 'Total Events',
  titleColor: 'primary'  // primary, secondary, danger, accent, subdued
})

// Badge
React.createElement(eui.EuiBadge, { color: 'danger' }, 'ERROR')
// colors: default, primary, secondary, danger, warning, hollow

// Text
React.createElement(eui.EuiText, { size: 's', color: 'subdued' }, 'Helper text')

// Card
React.createElement(eui.EuiCard, {
  title: 'Card Title',
  description: 'Description text',
  onClick: handler
})

// Empty prompt
React.createElement(eui.EuiEmptyPrompt, {
  iconType: 'search',
  title: React.createElement('h3', null, 'No results'),
  body: React.createElement('p', null, 'Try adjusting your filters.')
})`,

  forms: `# Form Components
var eui = require('@elastic/eui');

// Search field
React.createElement(eui.EuiFieldSearch, {
  placeholder: 'Search...',
  value: searchValue,
  onChange: function(e) { setSearch(e.target.value); },
  isClearable: true,
  fullWidth: true
})

// Select dropdown
React.createElement(eui.EuiSelect, {
  options: [
    { value: '', text: 'All' },
    { value: 'ERROR', text: 'Error' },
    { value: 'INFO', text: 'Info' }
  ],
  value: selectedValue,
  onChange: function(e) { setSelected(e.target.value); }
})

// Combo box (multi-select with search)
React.createElement(eui.EuiComboBox, {
  options: options,
  selectedOptions: selected,
  onChange: function(sel) { setSelected(sel); },
  placeholder: 'Select...'
})

// Form row with label
React.createElement(eui.EuiFormRow, { label: 'Filter by status' },
  React.createElement(eui.EuiSelect, { options: opts, value: val, onChange: handler })
)

// Button
React.createElement(eui.EuiButton, { fill: true, onClick: handler, isLoading: loading }, 'Submit')
React.createElement(eui.EuiButtonEmpty, { iconType: 'refresh', onClick: handler, size: 's' }, 'Refresh')

// Checkbox group
React.createElement(eui.EuiCheckboxGroup, {
  options: [{ id: 'opt1', label: 'Option 1' }, { id: 'opt2', label: 'Option 2' }],
  idToSelectedMap: { opt1: true, opt2: false },
  onChange: function(id) { toggle(id); }
})`,

  charts: `# Chart Components (ECharts via echarts-for-react)
var ReactECharts = require('echarts-for-react');

// Line chart
React.createElement(ReactECharts, {
  option: {
    xAxis: { type: 'category', data: ['Mon','Tue','Wed','Thu','Fri'] },
    yAxis: { type: 'value' },
    series: [{ type: 'line', data: [120, 200, 150, 80, 70], smooth: true }],
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 }
  },
  style: { height: '300px' }
})

// Bar chart
React.createElement(ReactECharts, {
  option: {
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: values, itemStyle: { color: '#006BB4' } }],
    tooltip: { trigger: 'axis' }
  },
  style: { height: '300px' }
})

// Pie chart
React.createElement(ReactECharts, {
  option: {
    series: [{
      type: 'pie', radius: '60%',
      data: [{ name: 'Success', value: 80 }, { name: 'Error', value: 20 }]
    }],
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 }
  },
  style: { height: '300px' }
})

// Sparkline (inline mini chart)
React.createElement(ReactECharts, {
  option: {
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { type: 'category', show: false, data: timestamps },
    yAxis: { type: 'value', show: false },
    series: [{ type: 'line', data: values, smooth: true, symbol: 'none',
      lineStyle: { width: 1.5, color: '#006BB4' },
      areaStyle: { color: 'rgba(0,107,180,0.1)' } }]
  },
  style: { height: '30px', width: '100px' }
})`,

  navigation: `# Navigation Components
var eui = require('@elastic/eui');

// Tabs
React.createElement(eui.EuiTabs, null,
  React.createElement(eui.EuiTab, { isSelected: tab === 'tab1', onClick: function() { setTab('tab1'); } }, 'Tab 1'),
  React.createElement(eui.EuiTab, { isSelected: tab === 'tab2', onClick: function() { setTab('tab2'); } }, 'Tab 2')
)

// Accordion
React.createElement(eui.EuiAccordion, { id: 'acc1', buttonContent: 'Advanced Filters' },
  React.createElement('div', null, filterContent)
)`,

  feedback: `# Feedback Components
var eui = require('@elastic/eui');

// Loading spinner
React.createElement(eui.EuiLoadingSpinner, { size: 'xl' })

// Loading chart placeholder
React.createElement(eui.EuiLoadingChart, { size: 'm' })

// Callout (info/warning/error)
React.createElement(eui.EuiCallOut, { title: 'Error', color: 'danger', iconType: 'alert' }, 'Details here')

// Toast (via props.api is not available — use EuiCallOut inline instead)`,
};
