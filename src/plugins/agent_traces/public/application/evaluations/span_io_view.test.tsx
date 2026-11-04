/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { IOSection, SpanIOView } from './span_io_view';

const INPUT = JSON.stringify([
  { role: 'system', parts: [{ type: 'text', content: 'Be brief.' }] },
  { role: 'user', parts: [{ type: 'text', content: 'Capital of France?' }] },
]);
const OUTPUT = JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Paris' }] }]);

const sections: IOSection[] = [
  { key: 'input', label: 'Input', value: INPUT },
  { key: 'output', label: 'Output', value: OUTPUT, note: 'gen_ai.output.messages' },
  { key: 'expected', label: 'Expected', value: undefined },
];

/**
 * The radio of a button group option. The option test id is on its label; clicking the label
 * is not enough in jsdom (generated ids are all the same), so click the radio inside.
 */
const optionRadio = (container: HTMLElement, testId: string) =>
  within(container).getByTestId(testId).querySelector('input') as HTMLElement;

const renderView = (props: Partial<React.ComponentProps<typeof SpanIOView>> = {}) =>
  render(
    <I18nProvider>
      <SpanIOView sections={sections} idPrefix="t" testId="io" {...props} />
    </I18nProvider>
  );

describe('SpanIOView', () => {
  it('shows role-labelled messages per section, with the note', () => {
    renderView();
    const io = screen.getByTestId('io');
    expect(
      within(io)
        .getAllByTestId(/^agtEvlIO-/)
        .map((el) => el.getAttribute('data-test-subj'))
    ).toEqual(['agtEvlIO-input', 'agtEvlIO-output', 'agtEvlIO-expected']);
    const input = screen.getByTestId('agtEvlIO-input');
    expect(input).toHaveTextContent('System');
    expect(input).toHaveTextContent('Be brief.');
    expect(input).toHaveTextContent('User');
    expect(input).toHaveTextContent('Capital of France?');
    expect(input).not.toHaveTextContent('"role"');
    const output = screen.getByTestId('agtEvlIO-output');
    expect(output).toHaveTextContent('Assistant');
    expect(output).toHaveTextContent('Paris');
    expect(output).toHaveTextContent('gen_ai.output.messages');
  });

  it('says Not recorded for an empty section, with no copy button', () => {
    renderView();
    const expected = screen.getByTestId('agtEvlIO-expected');
    expect(expected).toHaveTextContent('Not recorded');
    expect(within(expected).queryByTestId('agentTracesCopyMessage')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('agtEvlIO-input')).getByTestId('agentTracesCopyMessage')
    ).toBeInTheDocument();
  });

  it('switches every section to the attribute JSON with one toggle', () => {
    renderView();
    const io = screen.getByTestId('io');
    // One toggle, on the first section.
    expect(within(io).getAllByTestId('agentTracesMessageViewJson').length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('agtEvlIO-output')).queryByTestId('agentTracesMessageViewJson')
    ).not.toBeInTheDocument();
    fireEvent.click(optionRadio(io, 'agentTracesMessageViewJson'));
    expect(screen.getByTestId('agtEvlIO-input')).toHaveTextContent('"role": "user"');
    expect(screen.getByTestId('agtEvlIO-output')).toHaveTextContent('"role": "assistant"');
    expect(screen.getByTestId('agtEvlIO-expected')).toHaveTextContent('Not recorded');
    fireEvent.click(optionRadio(io, 'agentTracesMessageViewFormatted'));
    expect(screen.getByTestId('agtEvlIO-input')).not.toHaveTextContent('"role"');
  });

  it('shows plain text as is', () => {
    renderView({ sections: [{ key: 'expected', label: 'Expected', value: 'Paris' }] });
    expect(screen.getByTestId('agtEvlIO-expected')).toHaveTextContent('Paris');
  });

  it('hides the toggle when the caller fixes the mode', () => {
    renderView({ mode: 'json' });
    expect(screen.queryByTestId('agentTracesMessageViewJson')).not.toBeInTheDocument();
    expect(screen.getByTestId('agtEvlIO-input')).toHaveTextContent('"role": "user"');
  });
});
