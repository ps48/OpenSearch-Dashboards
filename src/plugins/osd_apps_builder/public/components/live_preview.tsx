/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import { EuiLoadingSpinner, EuiCallOut, EuiPanel } from '@elastic/eui';
import { renderAppCode, RenderResult } from '../services/app_renderer';
import { OsdAppApi } from '../services/scoped_api';
import { AppErrorBoundary } from './app_error_boundary';

interface LivePreviewProps {
  code: string;
  scopedApi: OsdAppApi;
  onRenderError?: (error: string) => void;
}

export const LivePreview: React.FC<LivePreviewProps> = ({ code, scopedApi, onRenderError }) => {
  const [result, setResult] = useState<RenderResult>({ component: null, error: null });
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!code.trim()) {
      setResult({ component: null, error: null });
      return;
    }

    setLoading(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      const rendered = await renderAppCode(code, scopedApi);
      setResult(rendered);
      setLoading(false);
      if (rendered.error && onRenderError) {
        onRenderError(rendered.error);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [code, scopedApi, onRenderError]);

  if (!code.trim()) {
    return (
      <EuiPanel
        paddingSize="l"
        color="subdued"
        data-test-subj="osdAppsPreviewEmpty"
        style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <p>Preview will appear here once you generate an app.</p>
      </EuiPanel>
    );
  }

  if (loading) {
    return (
      <EuiPanel
        paddingSize="l"
        data-test-subj="osdAppsPreviewLoading"
        style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <EuiLoadingSpinner size="xl" />
      </EuiPanel>
    );
  }

  if (result.error) {
    return (
      <EuiCallOut
        title="Render error"
        color="danger"
        iconType="alert"
        data-test-subj="osdAppsPreviewError"
      >
        <pre>{result.error}</pre>
      </EuiCallOut>
    );
  }

  if (result.component) {
    const AppComponent = result.component;
    return (
      <AppErrorBoundary>
        <AppComponent api={scopedApi} />
      </AppErrorBoundary>
    );
  }

  return null;
};
