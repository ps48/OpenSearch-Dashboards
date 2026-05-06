/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  EuiTitle,
  EuiResizableContainer,
  EuiSpacer,
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiText,
  EuiTextArea,
  EuiPanel,
  EuiFieldText,
} from '@elastic/eui';
import { CoreStart, SavedObjectsClientContract } from '../../../../../core/public';
import { DataPublicPluginStart } from '../../../../data/public';
import { ChatHistory } from './components/chat_history';
import { DataSourcePicker } from './components/data_source_picker';
import { SaveAppModal } from './components/save_app_modal';
import { LivePreview } from '../../components/live_preview';
import { CanvasEmptyAnimation } from '../../components/canvas_empty_animation';
import { AIClient } from '../../services/ai_client';
import { AppSavedObjectClient } from '../../services/app_saved_object_client';
import { createScopedApi, OsdAppApi } from '../../services/scoped_api';
import { fetchIndexMetadata, IndexMetadata } from '../../services/index_metadata';
import { PromptEntry, DataSourceRef } from '../../../../common/types';
import { SAMPLE_APPS } from '../../sample_apps';

interface AppBuilderPageProps {
  core: CoreStart;
  data: DataPublicPluginStart;
  savedObjectsClient: SavedObjectsClientContract;
  appId?: string;
}

interface ActivityEntry {
  timestamp: string;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

const SUGGESTIONS = [
  'Build a log explorer for OTel logs with severity filtering and service breakdown',
  'Create a metrics dashboard with stat cards and charts for nginx access logs',
  'Build a trace viewer with a Gantt chart flyout for span analysis',
];

export const AppBuilderPage: React.FC<AppBuilderPageProps> = ({
  core,
  data,
  savedObjectsClient,
  appId: initialAppId,
}) => {
  const [code, setCode] = useState('');
  const [promptHistory, setPromptHistory] = useState<PromptEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dataSourceRefs, setDataSourceRefs] = useState<DataSourceRef[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [appId, setAppId] = useState<string | undefined>(initialAppId);
  const [appTitle, setAppTitle] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [appTags, setAppTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [indexMetadataList, setIndexMetadataList] = useState<IndexMetadata[]>([]);
  const renderRepairCount = React.useRef(0);
  const [transitioning, setTransitioning] = useState(false);

  const hasStarted = promptHistory.length > 0 || isGenerating || !!code;

  const addActivity = useCallback((type: ActivityEntry['type'], message: string) => {
    setActivityLog((prev) => [
      ...prev,
      { timestamp: new Date().toLocaleTimeString(), type, message },
    ]);
  }, []);

  const aiClient = React.useMemo(() => new AIClient(core.http), [core.http]);
  const appClient = React.useMemo(() => new AppSavedObjectClient(savedObjectsClient), [
    savedObjectsClient,
  ]);
  const scopedApi: OsdAppApi = React.useMemo(() => createScopedApi({ core, data }), [core, data]);

  useEffect(() => {
    if (dataSourceRefs.length === 0) {
      setIndexMetadataList([]);
      return;
    }
    const fetchAll = async () => {
      addActivity('info', 'Fetching index metadata...');
      const results: IndexMetadata[] = [];
      for (const ref of dataSourceRefs) {
        try {
          const meta = await fetchIndexMetadata(core.http, ref.title);
          results.push(meta);
          addActivity('success', meta.indexName + ': ' + meta.totalFields + ' fields');
        } catch {
          addActivity('warning', 'Failed to fetch metadata');
        }
      }
      setIndexMetadataList(results);
    };
    fetchAll();
  }, [dataSourceRefs, core.http, addActivity]);

  useEffect(() => {
    if (!appId) return;
    appClient
      .load(appId)
      .then((attrs) => {
        setCode(attrs.sourceCode || '');
        setAppTitle(attrs.title || '');
        setAppDescription(attrs.description || '');
        setAppTags(attrs.tags || []);
        if (attrs.promptHistory) setPromptHistory(JSON.parse(attrs.promptHistory));
        if (attrs.dataSourceRefs) setDataSourceRefs(JSON.parse(attrs.dataSourceRefs));
        addActivity('success', 'Loaded: ' + attrs.title);
      })
      .catch((err) => core.notifications.toasts.addDanger('Failed to load: ' + err));
  }, [appId, appClient, core.notifications.toasts, addActivity]);

  const handleGenerate = useCallback(
    async (prompt: string) => {
      setPromptHistory((prev) => [
        ...prev,
        { role: 'user', content: prompt, timestamp: new Date().toISOString() },
      ]);
      setIsGenerating(true);
      renderRepairCount.current = 0;
      addActivity('info', 'Sending to AI...');
      let accumulated = '';
      try {
        const context: any = {};
        if (dataSourceRefs.length) context.dataSourceRefs = dataSourceRefs;
        if (indexMetadataList.length) {
          context.indexMetadata = indexMetadataList.map((m) => ({
            title: m.indexName,
            fields: m.fields,
            sampleDocs: m.sampleDocs.slice(0, 5),
          }));
        }
        const matchingSample = SAMPLE_APPS.find((s) =>
          dataSourceRefs.some((r) => s.prompt.indexOf(r.title) >= 0)
        );
        if (matchingSample) context.exampleCode = matchingSample.getCode();
        const options = {
          onStatus: (msg: string) => addActivity('info', msg),
          onWarning: (msg: string) => addActivity('warning', msg),
          onToolCall: (name: string) => addActivity('info', '\uD83D\uDD27 ' + name),
          onToolResult: (name: string, summary: string) =>
            addActivity('success', '\u2192 ' + name + ': ' + summary),
        };
        const gen = code
          ? aiClient.refine(prompt, code, context, options)
          : aiClient.generate(prompt, context, options);
        for await (const chunk of gen) {
          accumulated += chunk;
          setCode(accumulated);
        }
        addActivity('success', 'Canvas ready!');
        setPromptHistory((prev) => [
          ...prev,
          { role: 'assistant', content: accumulated, timestamp: new Date().toISOString() },
        ]);
      } catch (err) {
        addActivity('error', 'Failed: ' + err);
        core.notifications.toasts.addDanger('Generation failed: ' + err);
      } finally {
        setIsGenerating(false);
      }
    },
    [aiClient, code, dataSourceRefs, indexMetadataList, core.notifications.toasts, addActivity]
  );

  const handleRenderError = useCallback(
    async (error: string) => {
      if (isGenerating || !code || renderRepairCount.current >= 2) return;
      renderRepairCount.current += 1;
      setIsGenerating(true);
      addActivity('warning', 'Auto-fixing render error...');
      let accumulated = '';
      try {
        const gen = aiClient.refine('Fix: ' + error, code, undefined, {
          onStatus: (m) => addActivity('info', m),
        });
        for await (const chunk of gen) {
          accumulated += chunk;
          setCode(accumulated);
        }
        addActivity('success', 'Fixed');
      } catch {
        addActivity('error', 'Auto-fix failed');
      } finally {
        setIsGenerating(false);
      }
    },
    [aiClient, code, isGenerating, addActivity]
  );

  const handleSave = useCallback(
    async (title: string, description: string, tags: string[]) => {
      try {
        const id = await appClient.save(
          {
            title,
            description,
            tags,
            sourceCode: code,
            promptHistory: JSON.stringify(promptHistory),
            dataSourceRefs: JSON.stringify(dataSourceRefs),
            author: '',
          },
          appId
        );
        setAppId(id);
        setAppTitle(title);
        setAppDescription(description);
        setAppTags(tags);
        setShowSaveModal(false);
        core.notifications.toasts.addSuccess('Canvas saved');
      } catch (err) {
        core.notifications.toasts.addDanger('Save failed: ' + err);
      }
    },
    [appClient, appId, code, promptHistory, dataSourceRefs, core.notifications.toasts]
  );

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      if (!hasStarted) {
        setTransitioning(true);
        setTimeout(() => {
          handleGenerate(trimmed);
        }, 300);
      } else {
        handleGenerate(trimmed);
      }
      setInputValue('');
    }
  };

  /* ==================== LANDING VIEW ==================== */
  if (!hasStarted) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          opacity: transitioning ? 0 : 1,
          transition: 'opacity 0.3s ease-out',
        }}
      >
        <CanvasEmptyAnimation />
        <EuiSpacer size="l" />
        <EuiTitle size="l">
          <h1>What do you want to build?</h1>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiText color="subdued" textAlign="center">
          <p>Describe your app in plain English. Canvas generates it with real OpenSearch data.</p>
        </EuiText>
        <EuiSpacer size="l" />
        <div style={{ width: '100%', maxWidth: 680 }}>
          <DataSourcePicker
            onSelect={setDataSourceRefs}
            selectedRefs={dataSourceRefs}
            savedObjectsClient={savedObjectsClient}
          />
          <EuiSpacer size="s" />
          <EuiPanel paddingSize="s" hasBorder style={{ borderRadius: 12 }}>
            <EuiFlexGroup gutterSize="s" responsive={false} alignItems="flexEnd">
              <EuiFlexItem>
                <EuiTextArea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="Build a log explorer with severity filtering and charts..."
                  rows={3}
                  style={{ border: 'none', boxShadow: 'none', resize: 'none' }}
                  data-test-subj="osdAppsPromptInput"
                />
              </EuiFlexItem>
              <EuiFlexItem grow={false} style={{ paddingBottom: 4 }}>
                <EuiButton
                  fill
                  iconType="arrowRight"
                  onClick={handleSubmit}
                  disabled={!inputValue.trim()}
                >
                  Generate
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
        </div>
        <EuiSpacer size="l" />
        <EuiFlexGroup gutterSize="s" wrap justifyContent="center">
          {SUGGESTIONS.map((s, i) => (
            <EuiFlexItem key={i} grow={false}>
              <EuiPanel
                paddingSize="s"
                hasBorder
                style={{ cursor: 'pointer', borderRadius: 20 }}
                onClick={() => setInputValue(s)}
              >
                <EuiText size="xs" color="subdued">
                  {s}
                </EuiText>
              </EuiPanel>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
      </div>
    );
  }

  /* ==================== BUILDING VIEW ==================== */
  return (
    <>
      <style>
        {
          '@keyframes fadeSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }'
        }
      </style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          animation: 'fadeSlideIn 0.4s ease-out',
        }}
      >
        <EuiFlexGroup
          alignItems="center"
          justifyContent="spaceBetween"
          style={{ padding: '6px 16px', flexShrink: 0 }}
          responsive={false}
          gutterSize="none"
        >
          <EuiFlexItem grow={false}>
            <EuiTitle size="xs">
              <h1>{appTitle || 'Canvas Studio'}</h1>
            </EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              size="s"
              onClick={() => setShowSaveModal(true)}
              disabled={!code}
              data-test-subj="osdAppsSaveButton"
            >
              Save
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <EuiResizableContainer
            style={{ height: '100%' }}
            data-test-subj="osdAppsBuilderContainer"
          >
            {(EuiResizablePanel, EuiResizableButton) => (
              <>
                <EuiResizablePanel
                  initialSize={30}
                  minSize="250px"
                  paddingSize="none"
                  scrollable={false}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ height: '100%', overflow: 'hidden' }}>
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <div
                        style={{
                          flex: '1 1 auto',
                          overflowY: 'auto',
                          minHeight: 0,
                          padding: '8px 12px',
                        }}
                      >
                        <ChatHistory
                          entries={promptHistory}
                          activityLog={activityLog}
                          isGenerating={isGenerating}
                        />
                      </div>
                      <div
                        style={{
                          flex: '0 0 auto',
                          padding: '8px 12px',
                          borderTop: '1px solid #D3DAE6',
                        }}
                      >
                        <EuiFlexGroup gutterSize="xs" responsive={false}>
                          <EuiFlexItem>
                            <EuiFieldText
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSubmit();
                                }
                              }}
                              placeholder={code ? 'Refine your canvas...' : 'Describe...'}
                              disabled={isGenerating}
                              fullWidth
                              compressed
                              data-test-subj="osdAppsPromptInput"
                            />
                          </EuiFlexItem>
                          <EuiFlexItem grow={false}>
                            {isGenerating ? (
                              <EuiButton
                                size="s"
                                color="danger"
                                onClick={() => {
                                  setIsGenerating(false);
                                  addActivity('warning', 'Cancelled');
                                }}
                              >
                                Cancel
                              </EuiButton>
                            ) : (
                              <EuiButton
                                size="s"
                                fill
                                onClick={handleSubmit}
                                disabled={!inputValue.trim()}
                              >
                                {code ? '\u2191' : 'Go'}
                              </EuiButton>
                            )}
                          </EuiFlexItem>
                        </EuiFlexGroup>
                      </div>
                    </div>
                  </div>
                </EuiResizablePanel>
                <EuiResizableButton />
                <EuiResizablePanel
                  initialSize={70}
                  minSize="400px"
                  paddingSize="none"
                  scrollable={false}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ height: '100%', overflow: 'auto', padding: '12px' }}>
                    <LivePreview
                      code={code}
                      scopedApi={scopedApi}
                      onRenderError={handleRenderError}
                    />
                  </div>
                </EuiResizablePanel>
              </>
            )}
          </EuiResizableContainer>
        </div>
        {showSaveModal && (
          <SaveAppModal
            onSave={handleSave}
            onClose={() => setShowSaveModal(false)}
            initialTitle={appTitle}
            initialDescription={appDescription}
            initialTags={appTags}
          />
        )}
      </div>
    </>
  );
};
