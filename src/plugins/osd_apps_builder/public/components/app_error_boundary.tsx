/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EuiEmptyPrompt, EuiCodeBlock } from '@elastic/eui';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <EuiEmptyPrompt
          iconType="alert"
          iconColor="danger"
          title={<h3>App render error</h3>}
          body={
            <EuiCodeBlock language="text" paddingSize="s" isCopyable>
              {this.state.error?.message ?? 'Unknown error'}
            </EuiCodeBlock>
          }
          data-test-subj="osdAppsErrorBoundary"
        />
      );
    }
    return this.props.children;
  }
}
