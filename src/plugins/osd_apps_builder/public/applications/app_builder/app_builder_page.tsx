/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiTitle,
  EuiResizableContainer,
  EuiPanel,
  EuiSpacer,
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiCallOut,
  EuiText,
  EuiIcon,
  EuiButtonEmpty,
  EuiBottomBar,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CoreStart, SavedObjectsClientContract } from '../../../../../core/public';
import { DataPublicPluginStart } from '../../../../data/public';
import { PromptInput } from './components/prompt_input';
import { ChatHistory } from './components/chat_history';
import { PromptSuggestions } from './components/prompt_suggestions';
import { DataSourcePicker } from './components/data_source_picker';
import { SaveAppModal } from './components/save_app_modal';
import { LivePreview } from '../../components/live_preview';
import { AIClient } from '../../services/ai_client';
import { AppSavedObjectClient } from '../../services/app_saved_object_client';
import { createScopedApi, OsdAppApi } from '../../services/scoped_api';
import { PromptEntry, DataSourceRef } from '../../../../common/types';
import { fetchIndexMetadata, IndexMetadata } from '../../services/index_metadata';
import { SAMPLE_APPS } from '../../sample_apps';

const ACTIVITY_ICON_MAP: Record<string, string> = {
  info: 'clock',
  warning: 'alert',
  error: 'crossInACircleFilled',
  success: 'check',
};
const ACTIVITY_COLOR_MAP: Record<string, string> = {
  info: 'subdued',
  warning: 'warning',
  error: 'danger',
  success: 'secondary',
};

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
  const [suggestedPrompt, setSuggestedPrompt] = useState('');
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [indexMetadataList, setIndexMetadataList] = useState<IndexMetadata[]>([]);
  const renderRepairCount = React.useRef(0);
  const MAX_RENDER_REPAIRS = 2;

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

  // Fetch index metadata when data sources change
  useEffect(() => {
    if (dataSourceRefs.length === 0) {
      setIndexMetadataList([]);
      return;
    }
    const fetchAll = async () => {
      addActivity('info', 'Fetching index metadata for ' + dataSourceRefs.length + ' source(s)...');
      const results: IndexMetadata[] = [];
      for (let i = 0; i < dataSourceRefs.length; i++) {
        try {
          const meta = await fetchIndexMetadata(core.http, dataSourceRefs[i].title);
          results.push(meta);
          addActivity(
            'success',
            meta.indexName +
              ': ' +
              meta.totalFields +
              ' fields, ' +
              meta.sampleDocs.length +
              ' sample docs'
          );
        } catch (err) {
          addActivity('warning', 'Failed to fetch metadata for ' + dataSourceRefs[i].title);
        }
      }
      setIndexMetadataList(results);
    };
    fetchAll();
  }, [dataSourceRefs, core.http, addActivity]);

  // Load existing app if appId is provided
  useEffect(() => {
    if (!appId) return;
    const loadApp = async () => {
      try {
        const attrs = await appClient.load(appId);
        setCode(attrs.sourceCode || '');
        setAppTitle(attrs.title || '');
        setAppDescription(attrs.description || '');
        setAppTags(attrs.tags || []);
        if (attrs.promptHistory) setPromptHistory(JSON.parse(attrs.promptHistory));
        if (attrs.dataSourceRefs) setDataSourceRefs(JSON.parse(attrs.dataSourceRefs));
        addActivity('success', 'Loaded app: ' + attrs.title);
      } catch (err) {
        core.notifications.toasts.addDanger('Failed to load app: ' + err);
      }
    };
    loadApp();
  }, [appId, appClient, core.notifications.toasts, addActivity]);

  const handleGenerate = useCallback(
    async (prompt: string) => {
      const timestamp = new Date().toISOString();
      setPromptHistory((prev) => [...prev, { role: 'user', content: prompt, timestamp }]);
      setIsGenerating(true);
      renderRepairCount.current = 0;
      addActivity('info', 'Sending prompt to AI...');

      let accumulated = '';
      try {
        const context: any = {};
        if (dataSourceRefs.length) context.dataSourceRefs = dataSourceRefs;
        if (indexMetadataList.length) {
          context.indexMetadata = indexMetadataList.map(function (m) {
            return {
              title: m.indexName,
              fields: m.fields,
              sampleDocs: m.sampleDocs.slice(0, 5), // Send top 5 docs
            };
          });
        }
        // Include a matching sample app as a few-shot example if available
        const matchingSample = SAMPLE_APPS.find(function (s) {
          return dataSourceRefs.some(function (r) {
            return s.prompt.indexOf(r.title) >= 0;
          });
        });
        if (matchingSample) {
          context.exampleCode = matchingSample.getCode();
        }

        const options = {
          onStatus: (msg: string) => addActivity('info', msg),
          onWarning: (msg: string) => {
            addActivity('warning', msg);
            core.notifications.toasts.addWarning(msg);
          },
          onToolCall: (name: string, input: any) => {
            let inputStr = typeof input === 'object' ? JSON.stringify(input) : String(input);
            if (inputStr.length > 80) inputStr = inputStr.substring(0, 80) + '...';
            addActivity('info', '\uD83D\uDD27 ' + name + '(' + inputStr + ')');
          },
          onToolResult: (name: string, summary: string) => {
            addActivity('success', '\u2192 ' + name + ': ' + summary);
          },
        };
        const generator = code
          ? aiClient.refine(prompt, code, context, options)
          : aiClient.generate(prompt, context, options);

        for await (const chunk of generator) {
          accumulated += chunk;
          setCode(accumulated);
        }

        addActivity('success', 'Code generated (' + accumulated.length + ' chars)');
        setPromptHistory((prev) => [
          ...prev,
          { role: 'assistant', content: accumulated, timestamp: new Date().toISOString() },
        ]);
      } catch (err) {
        addActivity('error', 'Generation failed: ' + err);
        core.notifications.toasts.addDanger('Generation failed: ' + err);
      } finally {
        setIsGenerating(false);
      }
    },
    [aiClient, code, dataSourceRefs, indexMetadataList, core.notifications.toasts, addActivity]
  );

  const handleRenderError = useCallback(
    async (error: string) => {
      if (isGenerating || !code) return;
      if (renderRepairCount.current >= MAX_RENDER_REPAIRS) {
        addActivity('error', 'Auto-fix failed after ' + MAX_RENDER_REPAIRS + ' attempts');
        core.notifications.toasts.addDanger(
          'Auto-fix failed after ' + MAX_RENDER_REPAIRS + ' attempts. Try editing your prompt.'
        );
        return;
      }
      renderRepairCount.current += 1;
      setIsGenerating(true);
      addActivity('warning', 'Render error: ' + error.split('\n')[0]);
      addActivity('info', 'Auto-fixing (attempt ' + renderRepairCount.current + ')...');

      let accumulated = '';
      try {
        const fixPrompt =
          'The code you generated has a runtime error. Fix it and return ONLY the corrected code.\n\nError: ' +
          error;
        const options = {
          onStatus: (msg: string) => addActivity('info', msg),
          onWarning: (msg: string) => addActivity('warning', msg),
        };
        const generator = aiClient.refine(fixPrompt, code, undefined, options);

        for await (const chunk of generator) {
          accumulated += chunk;
          setCode(accumulated);
        }

        addActivity('success', 'Auto-fix complete');
        setPromptHistory((prev) => [
          ...prev,
          {
            role: 'user',
            content: 'Auto-fix: ' + error.split('\n')[0],
            timestamp: new Date().toISOString(),
          },
          { role: 'assistant', content: accumulated, timestamp: new Date().toISOString() },
        ]);
      } catch (err) {
        addActivity('error', 'Auto-fix failed: ' + err);
        core.notifications.toasts.addDanger('Auto-fix failed: ' + err);
      } finally {
        setIsGenerating(false);
      }
    },
    [aiClient, code, isGenerating, core.notifications.toasts, addActivity]
  );

  const handleSave = useCallback(
    async (title: string, description: string, tags: string[]) => {
      try {
        const savedId = await appClient.save(
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
        setAppId(savedId);
        setAppTitle(title);
        setAppDescription(description);
        setAppTags(tags);
        setShowSaveModal(false);
        addActivity('success', 'App saved: ' + title);
        core.notifications.toasts.addSuccess('App saved successfully');
      } catch (err) {
        core.notifications.toasts.addDanger('Save failed: ' + err);
      }
    },
    [appClient, appId, code, promptHistory, dataSourceRefs, core.notifications.toasts, addActivity]
  );

  // Memoize panel contents to prevent EuiResizableContainer rerender storms
  // (EuiResizableContainer triggers rerender on every mouseover)
  const leftPanelContent = React.useMemo(
    () => (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px', flexShrink: 0 }}>
          <DataSourcePicker
            onSelect={setDataSourceRefs}
            selectedRefs={dataSourceRefs}
            savedObjectsClient={savedObjectsClient}
          />
          <EuiSpacer size="s" />
          <PromptInput
            onSubmit={handleGenerate}
            isGenerating={isGenerating}
            initialValue={suggestedPrompt}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
          {promptHistory.length === 0 && !isGenerating ? (
            <PromptSuggestions onSelect={setSuggestedPrompt} />
          ) : (
            <ChatHistory entries={promptHistory} />
          )}
        </div>
        <div
          style={{
            maxHeight: '200px',
            overflowY: 'auto',
            padding: '8px 12px',
            borderTop: '1px solid #D3DAE6',
            flexShrink: 0,
          }}
        >
          <EuiText size="xs" color="subdued">
            <strong>Activity</strong>
          </EuiText>
          <EuiSpacer size="xs" />
          {activityLog.length === 0 ? (
            <EuiText size="xs" color="subdued">
              <p>Activity will appear here during generation.</p>
            </EuiText>
          ) : (
            activityLog.map((entry, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '6px',
                  marginBottom: '4px',
                }}
              >
                <EuiIcon
                  type={ACTIVITY_ICON_MAP[entry.type]}
                  color={ACTIVITY_COLOR_MAP[entry.type]}
                  size="s"
                  style={{ marginTop: '2px', flexShrink: 0 }}
                />
                <EuiText size="xs">
                  <span style={{ color: '#98A2B3' }}>{entry.timestamp}</span> {entry.message}
                </EuiText>
              </div>
            ))
          )}
        </div>
      </div>
    ),
    [
      dataSourceRefs,
      savedObjectsClient,
      handleGenerate,
      isGenerating,
      suggestedPrompt,
      promptHistory,
      activityLog,
      setDataSourceRefs,
      setSuggestedPrompt,
    ]
  );

  const rightPanelContent = React.useMemo(
    () => (
      <div style={{ height: '100%', padding: '12px' }}>
        <LivePreview code={code} scopedApi={scopedApi} onRenderError={handleRenderError} />
      </div>
    ),
    [code, scopedApi, handleRenderError]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <EuiFlexGroup
        alignItems="center"
        justifyContent="spaceBetween"
        style={{ padding: '8px 16px', flexShrink: 0 }}
        responsive={false}
        gutterSize="none"
      >
        <EuiFlexItem grow={false}>
          <EuiTitle size="s">
            <h1>
              {appTitle ||
                i18n.translate('osdAppsBuilder.builder.title', { defaultMessage: 'App Builder' })}
            </h1>
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

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <EuiResizableContainer style={{ height: '100%' }} data-test-subj="osdAppsBuilderContainer">
          {(EuiResizablePanel, EuiResizableButton) => (
            <>
              {/* Left panel: prompt + activity */}
              <EuiResizablePanel initialSize={35} minSize="280px" paddingSize="none">
                {leftPanelContent}
              </EuiResizablePanel>

              <EuiResizableButton />

              {/* Right panel: preview */}
              <EuiResizablePanel initialSize={65} minSize="400px" paddingSize="none">
                {rightPanelContent}
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
  );
};
