/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiEmptyPrompt,
  EuiLoadingSpinner,
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiButtonEmpty,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CoreStart } from '../../../../../core/public';
import { DataPublicPluginStart } from '../../../../data/public';
import { LivePreview } from '../../components/live_preview';
import { AppSavedObjectClient } from '../../services/app_saved_object_client';
import { createScopedApi } from '../../services/scoped_api';
import { OsdAppAttributes } from '../../../common/types';
import { BUILDER_APP_ID } from '../../../common/constants';

interface AppViewerPageProps {
  appId: string;
  core: CoreStart;
  data: DataPublicPluginStart;
}

export const AppViewerPage: React.FC<AppViewerPageProps> = ({ appId, core, data }) => {
  const [app, setApp] = useState<OsdAppAttributes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const appClient = React.useMemo(() => new AppSavedObjectClient(core.savedObjects.client), [
    core.savedObjects.client,
  ]);
  const scopedApi = React.useMemo(() => createScopedApi({ core, data }), [core, data]);

  useEffect(() => {
    const loadApp = async () => {
      try {
        const attrs = await appClient.load(appId);
        setApp(attrs);
        core.chrome.setBreadcrumbs([
          { text: 'Apps', href: '/app/osd-apps' },
          { text: attrs.title },
        ]);
      } catch (err) {
        setError(`App not found: ${err}`);
      } finally {
        setLoading(false);
      }
    };
    loadApp();
  }, [appId, appClient, core.chrome]);

  if (loading) {
    return (
      <EuiPage>
        <EuiPageBody>
          <EuiEmptyPrompt
            icon={<EuiLoadingSpinner size="xl" />}
            data-test-subj="osdAppsViewerLoading"
          />
        </EuiPageBody>
      </EuiPage>
    );
  }

  if (error || !app) {
    return (
      <EuiPage>
        <EuiPageBody>
          <EuiEmptyPrompt
            iconType="alert"
            title={
              <h2>
                {i18n.translate('osdAppsBuilder.viewer.notFound', {
                  defaultMessage: 'App not found',
                })}
              </h2>
            }
            data-test-subj="osdAppsViewerNotFound"
          />
        </EuiPageBody>
      </EuiPage>
    );
  }

  return (
    <EuiPage style={{ height: '100%' }}>
      <EuiPageBody style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <EuiFlexGroup justifyContent="flexEnd" gutterSize="s">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              iconType="pencil"
              onClick={() =>
                core.application.navigateToApp(BUILDER_APP_ID, { path: `?id=${appId}` })
              }
              data-test-subj="osdAppsViewerEditButton"
            >
              {i18n.translate('osdAppsBuilder.viewer.edit', { defaultMessage: 'Edit' })}
            </EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              iconType="share"
              onClick={() => {
                navigator.clipboard.writeText(
                  `${window.location.origin}/app/osd-apps/view/${appId}`
                );
                core.notifications.toasts.addSuccess('Link copied to clipboard');
              }}
              data-test-subj="osdAppsViewerShareButton"
            >
              {i18n.translate('osdAppsBuilder.viewer.share', { defaultMessage: 'Share' })}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
        <div style={{ flex: 1 }}>
          <LivePreview code={app.sourceCode} scopedApi={scopedApi} />
        </div>
      </EuiPageBody>
    </EuiPage>
  );
};
