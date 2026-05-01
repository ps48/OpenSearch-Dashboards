/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiPageContent,
  EuiPageContentBody,
  EuiPageHeader,
  EuiPageHeaderSection,
  EuiTitle,
  EuiButton,
  EuiInMemoryTable,
  EuiEmptyPrompt,
  EuiBadge,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiSpacer,
  EuiCard,
  EuiIcon,
  EuiModal,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiModalBody,
  EuiModalFooter,
  EuiButtonEmpty,
  EuiHorizontalRule,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  SavedObjectsClientContract,
  NotificationsStart,
  ApplicationStart,
} from '../../../../core/public';
import { SAVED_OBJECT_TYPE, BUILDER_APP_ID } from '../../../common/constants';
import { OsdAppAttributes } from '../../../common/types';
import { SAMPLE_APPS, SampleApp } from '../../sample_apps';
import { LivePreview } from '../../components/live_preview';
import { createScopedApi, OsdAppApi } from '../../services/scoped_api';

interface AppsListingPageProps {
  savedObjectsClient: SavedObjectsClientContract;
  notifications: NotificationsStart;
  application: ApplicationStart;
  core?: any;
  data?: any;
}

interface AppItem {
  id: string;
  title: string;
  description: string;
  tags: string[];
  updatedAt: string;
}

export const AppsListingPage: React.FC<AppsListingPageProps> = ({
  savedObjectsClient,
  notifications,
  application,
  core,
  data,
}) => {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewApp, setPreviewApp] = useState<SampleApp | null>(null);
  const [installingData, setInstallingData] = useState(false);

  // Map sample app IDs to the sample dataset IDs they need
  const SAMPLE_DATA_MAP: Record<string, string> = {
    'web-logs-explorer': 'logs',
    'flight-delays-dashboard': 'flights',
    'ecommerce-overview': 'ecommerce',
  };

  const ensureSampleDataInstalled = async (sampleApp: SampleApp) => {
    const datasetId = SAMPLE_DATA_MAP[sampleApp.id];
    if (!datasetId) {
      setPreviewApp(sampleApp);
      return;
    }

    try {
      // Check if sample data is installed
      const response = await fetch('/api/sample_data', {
        headers: { 'osd-xsrf': 'true' },
      });
      const datasets = await response.json();
      const dataset = datasets.find(function (d: any) {
        return d.id === datasetId;
      });

      if (dataset && dataset.status === 'installed') {
        setPreviewApp(sampleApp);
        return;
      }

      // Not installed — install it
      setInstallingData(true);
      notifications.toasts.addInfo('Installing ' + datasetId + ' sample data...');

      const installResponse = await fetch('/api/sample_data/' + datasetId, {
        method: 'POST',
        headers: { 'osd-xsrf': 'true' },
      });

      if (installResponse.ok) {
        notifications.toasts.addSuccess('Sample data installed successfully');
        setPreviewApp(sampleApp);
      } else {
        notifications.toasts.addDanger('Failed to install sample data');
      }
    } catch (err) {
      notifications.toasts.addDanger('Error checking sample data: ' + err);
    } finally {
      setInstallingData(false);
    }
  };

  const scopedApi: OsdAppApi | null = React.useMemo(() => {
    if (core && data) return createScopedApi({ core, data });
    return {
      search: async () => ({ rawResponse: { hits: { hits: [] } } }),
      theme: { isDarkMode: false },
      timeRange: { from: 'now-15m', to: 'now' },
      navigateToApp: () => {},
    };
  }, [core, data]);

  useEffect(() => {
    const fetchApps = async () => {
      try {
        const response = await savedObjectsClient.find<OsdAppAttributes>({
          type: SAVED_OBJECT_TYPE,
          perPage: 1000,
          sortField: 'updatedAt',
          sortOrder: 'desc',
        });
        setApps(
          response.savedObjects.map((obj) => ({
            id: obj.id,
            title: obj.attributes.title,
            description: obj.attributes.description || '',
            tags: obj.attributes.tags || [],
            updatedAt: obj.attributes.updatedAt || obj.updated_at || '',
          }))
        );
      } catch (err) {
        notifications.toasts.addDanger('Failed to load apps');
      } finally {
        setLoading(false);
      }
    };
    fetchApps();
  }, [savedObjectsClient, notifications]);

  const columns = [
    {
      field: 'title',
      name: 'Title',
      sortable: true,
      render: (title: string, item: AppItem) => (
        <EuiLink
          onClick={() => application.navigateToApp('osd-apps', { path: '/view/' + item.id })}
          data-test-subj={'osdAppsListingLink-' + item.id}
        >
          {title}
        </EuiLink>
      ),
    },
    { field: 'description', name: 'Description', truncateText: true },
    {
      field: 'tags',
      name: 'Tags',
      render: (tags: string[]) => (
        <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
          {tags.map((tag) => (
            <EuiFlexItem grow={false} key={tag}>
              <EuiBadge>{tag}</EuiBadge>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
      ),
    },
    { field: 'updatedAt', name: 'Last updated', sortable: true, dataType: 'date' as const },
  ];

  const search = {
    box: { incremental: true, 'data-test-subj': 'osdAppsListingSearchBox' },
  };

  return (
    <EuiPage>
      <EuiPageBody>
        <EuiPageHeader>
          <EuiPageHeaderSection>
            <EuiTitle size="l">
              <h1>Apps</h1>
            </EuiTitle>
          </EuiPageHeaderSection>
          <EuiPageHeaderSection>
            <EuiButton
              fill
              onClick={() => application.navigateToApp(BUILDER_APP_ID)}
              data-test-subj="osdAppsCreateButton"
            >
              Create app
            </EuiButton>
          </EuiPageHeaderSection>
        </EuiPageHeader>

        <EuiSpacer />

        {/* Sample Apps */}
        <EuiTitle size="s">
          <h2>Sample Apps</h2>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiText size="s" color="subdued">
          <p>Try these pre-built examples to see what OSD Apps can do.</p>
        </EuiText>
        <EuiSpacer size="m" />
        <EuiFlexGroup gutterSize="m" wrap>
          {SAMPLE_APPS.map((sample) => (
            <EuiFlexItem key={sample.id} style={{ maxWidth: 320 }}>
              <EuiCard
                icon={<EuiIcon type={sample.icon} size="xl" />}
                title={sample.title}
                description={sample.description}
                footer={
                  <EuiButton
                    size="s"
                    onClick={() => ensureSampleDataInstalled(sample)}
                    isLoading={installingData}
                    data-test-subj={'osdAppsSamplePreview-' + sample.id}
                  >
                    Preview
                  </EuiButton>
                }
              />
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>

        <EuiSpacer size="xl" />
        <EuiHorizontalRule />

        {/* My Apps */}
        <EuiTitle size="s">
          <h2>My Apps</h2>
        </EuiTitle>
        <EuiSpacer size="m" />
        <EuiPageContent>
          <EuiPageContentBody>
            {!loading && apps.length === 0 ? (
              <EuiEmptyPrompt
                iconType="apps"
                title={<h3>No apps yet</h3>}
                body={<p>Create your first app using the App Builder or try a sample above.</p>}
                actions={
                  <EuiButton
                    fill
                    onClick={() => application.navigateToApp(BUILDER_APP_ID)}
                    data-test-subj="osdAppsCreateFirstButton"
                  >
                    Create app
                  </EuiButton>
                }
              />
            ) : (
              <EuiInMemoryTable
                items={apps}
                columns={columns}
                search={search}
                pagination={{ initialPageSize: 20, pageSizeOptions: [10, 20, 50] }}
                sorting={{ sort: { field: 'updatedAt', direction: 'desc' } }}
                loading={loading}
                data-test-subj="osdAppsListingTable"
              />
            )}
          </EuiPageContentBody>
        </EuiPageContent>

        {/* Preview Modal */}
        {previewApp && scopedApi && (
          <EuiModal onClose={() => setPreviewApp(null)} style={{ width: '90vw', height: '80vh' }}>
            <EuiModalHeader>
              <EuiModalHeaderTitle>
                <EuiFlexGroup alignItems="center" gutterSize="s">
                  <EuiFlexItem grow={false}>
                    <EuiIcon type={previewApp.icon} size="l" />
                  </EuiFlexItem>
                  <EuiFlexItem>{previewApp.title}</EuiFlexItem>
                </EuiFlexGroup>
              </EuiModalHeaderTitle>
            </EuiModalHeader>
            <EuiModalBody>
              <div style={{ height: '100%', minHeight: '500px' }}>
                <LivePreview code={previewApp.getCode()} scopedApi={scopedApi} />
              </div>
            </EuiModalBody>
            <EuiModalFooter>
              <EuiButtonEmpty onClick={() => setPreviewApp(null)}>Close</EuiButtonEmpty>
            </EuiModalFooter>
          </EuiModal>
        )}
      </EuiPageBody>
    </EuiPage>
  );
};
