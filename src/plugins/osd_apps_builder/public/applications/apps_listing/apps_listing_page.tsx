/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiTitle,
  EuiButton,
  EuiInMemoryTable,
  EuiEmptyPrompt,
  EuiBadge,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiSpacer,
  EuiIcon,
  EuiModal,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiModalBody,
  EuiModalFooter,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiHorizontalRule,
  EuiText,
  EuiPanel,
  EuiToolTip,
} from '@elastic/eui';
import {
  SavedObjectsClientContract,
  NotificationsStart,
  ApplicationStart,
} from '../../../../core/public';
import { SAVED_OBJECT_TYPE, BUILDER_APP_ID } from '../../../common/constants';
import { OsdAppAttributes } from '../../../common/types';
import { SAMPLE_APPS, SampleApp } from '../../sample_apps';
import { LivePreview } from '../../components/live_preview';
import { CanvasEmptyAnimation } from '../../components/canvas_empty_animation';
import { createScopedApi, OsdAppApi } from '../../services/scoped_api';

interface AppsListingPageProps {
  savedObjectsClient: SavedObjectsClientContract;
  notifications: NotificationsStart;
  application: ApplicationStart;
  core?: any;
  data?: any;
  navigation?: any;
}

interface AppItem {
  id: string;
  title: string;
  description: string;
  tags: string[];
  updatedAt: string;
}

const SAMPLE_DATA_MAP: Record<string, string> = {
  'web-logs-explorer': 'logs',
  'flight-delays-dashboard': 'flights',
  'ecommerce-overview': 'ecommerce',
};

export const AppsListingPage: React.FC<AppsListingPageProps> = ({
  savedObjectsClient,
  notifications,
  application,
  core,
  data,
  navigation,
}) => {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewApp, setPreviewApp] = useState<SampleApp | null>(null);
  const [installingData, setInstallingData] = useState(false);

  const scopedApi: OsdAppApi = React.useMemo(() => {
    if (core && data) return createScopedApi({ core, data });
    return {
      search: async () => ({ jsonData: [], size: 0 }),
      theme: { isDarkMode: false },
      timeRange: { from: 'now-15m', to: 'now' },
      navigateToApp: () => {},
    };
  }, [core, data]);

  useEffect(() => {
    // Reset breadcrumbs when listing page mounts
    if (core?.chrome) {
      core.chrome.setBreadcrumbs([{ text: 'Canvas' }]);
    }
  }, [core]);

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
      } catch {
        notifications.toasts.addDanger('Failed to load canvases');
      } finally {
        setLoading(false);
      }
    };
    fetchApps();
  }, [savedObjectsClient, notifications]);

  const ensureSampleDataInstalled = async (sampleApp: SampleApp) => {
    const datasetId = SAMPLE_DATA_MAP[sampleApp.id];
    if (!datasetId) {
      setPreviewApp(sampleApp);
      return;
    }
    try {
      const resp = await fetch('/api/sample_data', { headers: { 'osd-xsrf': 'true' } });
      const datasets = await resp.json();
      if (datasets.find((d: any) => d.id === datasetId && d.status === 'installed')) {
        setPreviewApp(sampleApp);
        return;
      }
      setInstallingData(true);
      notifications.toasts.addInfo('Installing sample data...');
      const installResp = await fetch('/api/sample_data/' + datasetId, {
        method: 'POST',
        headers: { 'osd-xsrf': 'true' },
      });
      if (installResp.ok) {
        notifications.toasts.addSuccess('Sample data installed');
        setPreviewApp(sampleApp);
      } else notifications.toasts.addDanger('Failed to install sample data');
    } catch (err) {
      notifications.toasts.addDanger('Error: ' + err);
    } finally {
      setInstallingData(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    try {
      await savedObjectsClient.delete(SAVED_OBJECT_TYPE, id);
      setApps((prev) => prev.filter((a) => a.id !== id));
      notifications.toasts.addSuccess('Deleted "' + title + '"');
    } catch {
      notifications.toasts.addDanger('Failed to delete');
    }
  };

  const columns = [
    {
      field: 'title',
      name: 'Title',
      render: (title: string, item: AppItem) => (
        <EuiLink
          onClick={() => application.navigateToApp('osd-apps', { path: '/view/' + item.id })}
        >
          {title}
        </EuiLink>
      ),
    },
    {
      field: 'description',
      name: 'Description',
      truncateText: true,
      render: (desc: string) => (
        <EuiText size="s" color="subdued">
          {desc || '\u2014'}
        </EuiText>
      ),
    },
    {
      field: 'tags',
      name: 'Tags',
      width: '140px',
      render: (tags: string[]) =>
        tags.map((t) => (
          <EuiBadge key={t} color="hollow">
            {t}
          </EuiBadge>
        )),
    },
    { field: 'updatedAt', name: 'Updated', width: '160px', dataType: 'date' as const },
    {
      name: '',
      width: '70px',
      render: (item: AppItem) => (
        <EuiFlexGroup gutterSize="xs" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiToolTip content="Edit">
              <EuiButtonIcon
                iconType="pencil"
                aria-label="Edit"
                color="text"
                onClick={() =>
                  application.navigateToApp(BUILDER_APP_ID, { path: '?id=' + item.id })
                }
              />
            </EuiToolTip>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiToolTip content="Delete">
              <EuiButtonIcon
                iconType="trash"
                aria-label="Delete"
                color="danger"
                onClick={() => handleDelete(item.id, item.title)}
              />
            </EuiToolTip>
          </EuiFlexItem>
        </EuiFlexGroup>
      ),
    },
  ];

  return (
    <EuiPage paddingSize="l">
      <EuiPageBody>
        {/* Create button in app header */}
        {navigation?.ui?.HeaderControl && application.setAppRightControls && (
          <navigation.ui.HeaderControl
            setMountPoint={application.setAppRightControls}
            controls={[
              {
                renderComponent: (
                  <EuiButton
                    fill
                    iconType="plus"
                    size="s"
                    onClick={() => application.navigateToApp(BUILDER_APP_ID)}
                    data-test-subj="osdAppsCreateButton"
                  >
                    Create canvas
                  </EuiButton>
                ),
              },
            ]}
          />
        )}

        <EuiSpacer size="m" />

        {/* Preview Examples */}
        <EuiText size="xs" color="subdued">
          <strong>Preview Examples</strong>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s" responsive={false} wrap>
          {SAMPLE_APPS.map((sample) => (
            <EuiFlexItem key={sample.id} grow={true}>
              <EuiPanel
                paddingSize="s"
                hasBorder
                style={{ cursor: 'pointer' }}
                onClick={() => ensureSampleDataInstalled(sample)}
              >
                <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                  <EuiFlexItem grow={false}>
                    <EuiIcon type={sample.icon} size="m" />
                  </EuiFlexItem>
                  <EuiFlexItem>
                    <EuiText size="s">
                      <strong>{sample.title}</strong>
                    </EuiText>
                    <EuiText size="xs" color="subdued">
                      {sample.description}
                    </EuiText>
                  </EuiFlexItem>
                </EuiFlexGroup>
              </EuiPanel>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>

        <EuiSpacer size="l" />

        {/* My Canvases */}
        {!loading && apps.length === 0 ? (
          <EuiPanel paddingSize="l" hasBorder>
            <EuiEmptyPrompt
              icon={<CanvasEmptyAnimation />}
              body={
                <p>
                  Describe what you want to build in plain English — Canvas generates interactive
                  apps with charts, tables, and filters from your OpenSearch data.
                </p>
              }
              actions={
                <EuiButton
                  fill
                  iconType="plus"
                  onClick={() => application.navigateToApp(BUILDER_APP_ID)}
                  data-test-subj="osdAppsCreateFirstButton"
                >
                  Create your first canvas
                </EuiButton>
              }
            />
          </EuiPanel>
        ) : (
          <EuiPanel hasBorder paddingSize="m">
            <EuiInMemoryTable
              items={apps}
              columns={columns}
              search={{ box: { incremental: true, placeholder: 'Search canvases...' } }}
              pagination={{ initialPageSize: 20, pageSizeOptions: [10, 20, 50] }}
              sorting={{ sort: { field: 'updatedAt', direction: 'desc' } }}
              loading={loading}
              data-test-subj="osdAppsListingTable"
            />
          </EuiPanel>
        )}

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
