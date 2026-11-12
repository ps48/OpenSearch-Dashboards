/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCode,
  EuiCodeBlock,
  EuiEmptyPrompt,
  EuiFlexGrid,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import type { DataIssue } from './eval_data_issue';
import {
  CodingAgentQuickStart,
  CopyCodingAgentPromptButton,
  EvalScreenshot,
  OnlineOfflineCards,
  Screenshot,
} from './eval_onboarding';

/** The Agent evaluations docs (producing results, pass rules) and the AI observability docs. */
export const AGENT_EVALS_DOCS_URL = 'https://observability.opensearch.org/docs/agent-evals/';
export const AI_OBSERVABILITY_DOCS_URL =
  'https://observability.opensearch.org/docs/ai-observability/';
export const EVALS_QUICKSTART_URL = `${AGENT_EVALS_DOCS_URL}quickstart/`;
export const EVALS_CI_URL = `${AGENT_EVALS_DOCS_URL}ci/`;

export const SDK_SNIPPET = `pip install "opensearch-genai-observability-sdk-py>=0.3.0"

from opensearch_genai_observability_sdk_py import register, score
register(agent_name="travel_planner", agent_version="v3")
score(name="answer_quality", value=4, score_min=1, score_max=5,
      threshold=4, explanation="Used the tool results.")`;

/** The Agents home with no results in the range: how to send them (SDK snippet, links). */
export const AgentsEmptyState: React.FC<{ range: string }> = ({ range }) => (
  <div className="agtEvlSnippet" data-test-subj="agtEvlAgentsEmpty">
    <EuiText size="s" textAlign="left">
      <h3>
        {i18n.translate('agentTraces.evalsEmpty.agentsTitle', {
          defaultMessage: 'No evaluation results in the range: {range}',
          values: { range },
        })}
      </h3>
      <p className="agtEvlDim">
        {i18n.translate('agentTraces.evalsEmpty.agentsLead', {
          defaultMessage: 'Results appear here a few seconds after your code sends them.',
        })}
      </p>
    </EuiText>
    <EuiSpacer size="s" />
    <CodingAgentQuickStart />
    <EuiSpacer size="m" />
    <EuiText size="s" textAlign="left">
      <p className="agtEvlDim">
        {i18n.translate('agentTraces.evalsEmpty.agentsBody', {
          defaultMessage: 'Or add the OpenSearch GenAI SDK yourself:',
        })}
      </p>
    </EuiText>
    <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable>
      {SDK_SNIPPET}
    </EuiCodeBlock>
    <EuiSpacer size="s" />
    <EuiText size="s" textAlign="left">
      <p>
        <FormattedMessage
          id="agentTraces.evalsEmpty.agentsProducers"
          defaultMessage="Any OpenTelemetry producer works: send {event} log events."
          values={{ event: <EuiCode>gen_ai.evaluation.result</EuiCode> }}
        />{' '}
        <EuiLink href={EVALS_QUICKSTART_URL} target="_blank" data-test-subj="agtEvlQuickstart">
          {i18n.translate('agentTraces.evalsEmpty.quickstart', { defaultMessage: 'Quickstart' })}
        </EuiLink>
        {' · '}
        <EuiLink href={EVALS_CI_URL} target="_blank" data-test-subj="agtEvlSuiteInCi">
          {i18n.translate('agentTraces.evalsEmpty.suiteInCi', {
            defaultMessage: 'Run a test suite in CI',
          })}
        </EuiLink>
      </p>
    </EuiText>
  </div>
);

const FEATURES: Array<{ shot: EvalScreenshot; title: string; text: string }> = [
  {
    shot: 'agents_home',
    title: i18n.translate('agentTraces.evalsEmpty.featureAgents', {
      defaultMessage: 'Every agent version at a glance',
    }),
    text: i18n.translate('agentTraces.evalsEmpty.featureAgentsText', {
      defaultMessage:
        'One row per agent version with its pass rate and results, including two versions running side by side.',
    }),
  },
  {
    shot: 'agent_page',
    title: i18n.translate('agentTraces.evalsEmpty.featureTrend', {
      defaultMessage: 'Pass rate over time, per version',
    }),
    text: i18n.translate('agentTraces.evalsEmpty.featureTrendText', {
      defaultMessage:
        'See a deploy change quality, compare two versions evaluation by evaluation, and open the failing results.',
    }),
  },
  {
    shot: 'compare_runs',
    title: i18n.translate('agentTraces.evalsEmpty.featureCompare', {
      defaultMessage: 'Compare two test runs',
    }),
    text: i18n.translate('agentTraces.evalsEmpty.featureCompareText', {
      defaultMessage:
        'The cases that regressed or got fixed between two runs, with both outputs and both traces side by side.',
    }),
  },
  {
    shot: 'agent_traces',
    title: i18n.translate('agentTraces.evalsEmpty.featureTraces', {
      defaultMessage: 'Debug in Agent Traces',
    }),
    text: i18n.translate('agentTraces.evalsEmpty.featureTracesText', {
      defaultMessage:
        'Each trace shows its evaluation results, and the trace flyout marks the spans that were judged.',
    }),
  },
];

/**
 * Nothing configured: what Agent Evaluations does (online and offline evaluations, product
 * screenshots), Set up (auto-detects the data and saves the settings) and Getting started.
 */
export const NoEvalsDatasetPrompt: React.FC<{
  onSetUp: () => void;
  onGettingStarted: () => void;
  /** The config lookup failed. */
  error?: string;
}> = ({ onSetUp, onGettingStarted, error }) => (
  <div className="agtEvlShowcase" data-test-subj="agtEvlNoDataset">
    <EuiPanel paddingSize="l" hasShadow={false} hasBorder className="agtEvlShowcase__hero">
      <EuiFlexGroup gutterSize="xl" alignItems="center">
        <EuiFlexItem grow={5}>
          <EuiTitle size="l">
            <h2>
              <FormattedMessage
                id="agentTraces.evalsEmpty.title"
                defaultMessage="Measure how well your agents do their job"
              />
            </h2>
          </EuiTitle>
          <EuiSpacer size="m" />
          <EuiText size="m" color="subdued">
            <p>
              <FormattedMessage
                id="agentTraces.evalsEmpty.body"
                defaultMessage="Agent Evaluations shows the verdicts your evaluators give your agents' spans, traces and sessions, as OpenTelemetry {event} events next to your traces: pass rates per agent version, regressions between test runs, and the traces where an evaluation failed."
                values={{ event: <EuiCode>gen_ai.evaluation.result</EuiCode> }}
              />
            </p>
          </EuiText>
          <EuiSpacer size="l" />
          {error && (
            <>
              <EuiCallOut
                size="s"
                color="danger"
                iconType="alert"
                title={i18n.translate('agentTraces.evalsEmpty.lookupError', {
                  defaultMessage: 'Could not read the evaluations dataset settings',
                })}
                data-test-subj="agtEvlNoDatasetError"
              >
                <p className="agtEvlMono">{error}</p>
              </EuiCallOut>
              <EuiSpacer size="m" />
            </>
          )}
          <EuiFlexGroup gutterSize="s" responsive={false} wrap alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiButton
                size="s"
                fill
                iconType="gear"
                onClick={onSetUp}
                data-test-subj="agtEvlGetStarted"
              >
                {i18n.translate('agentTraces.evalsEmpty.setUp', {
                  defaultMessage: 'Set up evaluations',
                })}
              </EuiButton>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <CopyCodingAgentPromptButton data-test-subj="agtEvlCopyPromptHero" />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButton
                size="s"
                iconType="help"
                onClick={onGettingStarted}
                data-test-subj="agtEvlTour"
              >
                {i18n.translate('agentTraces.evalsEmpty.gettingStarted', {
                  defaultMessage: 'Getting started',
                })}
              </EuiButton>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiLink
                href={AGENT_EVALS_DOCS_URL}
                target="_blank"
                external
                data-test-subj="agtEvlEvalsDocsLink"
              >
                {i18n.translate('agentTraces.evalsEmpty.evalsDocsLink', {
                  defaultMessage: 'Agent evaluations docs',
                })}
              </EuiLink>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={6}>
          <Screenshot
            name="agents_home"
            alt={i18n.translate('agentTraces.evalsEmpty.heroAlt', {
              defaultMessage: 'The Agents page: pass rate per agent version',
            })}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiPanel>
    <EuiSpacer size="l" />
    <EuiTitle size="s">
      <h3>
        {i18n.translate('agentTraces.evalsEmpty.twoWays', {
          defaultMessage: 'Two ways to evaluate',
        })}
      </h3>
    </EuiTitle>
    <EuiSpacer size="s" />
    <OnlineOfflineCards />
    <EuiSpacer size="l" />
    <EuiTitle size="s">
      <h3>
        {i18n.translate('agentTraces.evalsEmpty.whatYouGet', {
          defaultMessage: 'What you can do',
        })}
      </h3>
    </EuiTitle>
    <EuiSpacer size="s" />
    <EuiFlexGrid columns={2} gutterSize="m" data-test-subj="agtEvlFeatures">
      {FEATURES.map((f) => (
        <EuiFlexItem key={f.shot}>
          <EuiPanel hasBorder hasShadow={false} paddingSize="m">
            <Screenshot name={f.shot} alt={f.title} />
            <EuiSpacer size="s" />
            <EuiTitle size="xs">
              <h4>{f.title}</h4>
            </EuiTitle>
            <EuiText size="s" color="subdued">
              <p>{f.text}</p>
            </EuiText>
          </EuiPanel>
        </EuiFlexItem>
      ))}
    </EuiFlexGrid>
    <EuiSpacer size="xl" />
  </div>
);

export interface QuickRangeButton {
  /** Relative start, to `now`. */
  from: string;
  label: string;
}

export const LAST_24H: QuickRangeButton = {
  from: 'now-24h',
  label: i18n.translate('agentTraces.evalsEmpty.last24h', { defaultMessage: 'Last 24 hours' }),
};
export const LAST_7D: QuickRangeButton = {
  from: 'now-7d',
  label: i18n.translate('agentTraces.evalsEmpty.last7d', { defaultMessage: 'Last 7 days' }),
};
export const LAST_30D: QuickRangeButton = {
  from: 'now-30d',
  label: i18n.translate('agentTraces.evalsEmpty.last30d', { defaultMessage: 'Last 30 days' }),
};

/**
 * The dataset is set up but the range holds nothing: one click to a wider range, and to
 * clearing the filters when some are set.
 */
export const NoResultsInRange: React.FC<{
  title?: React.ReactNode;
  body?: React.ReactNode;
  ranges: QuickRangeButton[];
  onSelectRange?: (from: string) => void;
  onClearFilters?: () => void;
  iconType?: string;
  'data-test-subj'?: string;
}> = ({ title, body, ranges, onSelectRange, onClearFilters, iconType = 'search', ...rest }) => (
  <EuiEmptyPrompt
    iconType={iconType}
    data-test-subj={rest['data-test-subj'] ?? 'agtEvlNoResultsInRange'}
    title={
      <h3>
        {title ?? (
          <FormattedMessage
            id="agentTraces.evalsEmpty.noResultsTitle"
            defaultMessage="No evaluation results in this time range"
          />
        )}
      </h3>
    }
    body={
      <EuiText size="s">
        {body ?? (
          <p>
            {onClearFilters ? (
              <FormattedMessage
                id="agentTraces.evalsEmpty.noResultsFilteredBody"
                defaultMessage="Nothing matches these filters in this range. Widen the range or clear the filters."
              />
            ) : (
              <FormattedMessage
                id="agentTraces.evalsEmpty.noResultsBody"
                defaultMessage="Evaluations ran outside this range, or have not run yet. Widen the range."
              />
            )}
          </p>
        )}
      </EuiText>
    }
    actions={
      onSelectRange || onClearFilters ? (
        <EuiFlexGroup gutterSize="s" justifyContent="center" responsive={false} wrap>
          {onSelectRange &&
            ranges.map((r, i) => (
              <EuiFlexItem grow={false} key={r.from}>
                <EuiButton
                  size="s"
                  fill={i === 0}
                  iconType="calendar"
                  onClick={() => onSelectRange(r.from)}
                  data-test-subj={`agtEvlEmptyRange-${r.from}`}
                >
                  {r.label}
                </EuiButton>
              </EuiFlexItem>
            ))}
          {onClearFilters && (
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty
                size="s"
                onClick={onClearFilters}
                data-test-subj="agtEvlEmptyClearFilters"
              >
                {i18n.translate('agentTraces.evalsEmpty.clearFilters', {
                  defaultMessage: 'Clear filters',
                })}
              </EuiButtonEmpty>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      ) : undefined
    }
  />
);

/** What `DataIssuePrompt` explains: a classified query error, or a deleted dataset. */
export type DataIssueView = DataIssue | { kind: 'dataset-missing'; field?: undefined };

const ISSUE_TITLE: Record<DataIssueView['kind'], (v: { index: string; field?: string }) => string> =
  {
    'dataset-missing': () =>
      i18n.translate('agentTraces.evalsIssue.datasetMissingTitle', {
        defaultMessage: 'The evaluations dataset was deleted',
      }),
    'index-missing': ({ index }) =>
      i18n.translate('agentTraces.evalsIssue.indexMissingTitle', {
        defaultMessage: 'No index matches {index}',
        values: { index },
      }),
    'no-results': ({ index }) =>
      i18n.translate('agentTraces.evalsIssue.noResultsTitle', {
        defaultMessage: 'No evaluation results in {index} yet',
        values: { index },
      }),
    'field-missing': ({ field }) =>
      field
        ? i18n.translate('agentTraces.evalsIssue.fieldMissingTitle', {
            defaultMessage: 'The evaluation indices have no field {field}',
            values: { field },
          })
        : i18n.translate('agentTraces.evalsIssue.fieldMissingTitleAny', {
            defaultMessage: 'The evaluation indices lack fields these views query',
          }),
    'data-source': () =>
      i18n.translate('agentTraces.evalsIssue.dataSourceTitle', {
        defaultMessage: 'The data source of the evaluations dataset is not available',
      }),
    'data-source-auth': () =>
      i18n.translate('agentTraces.evalsIssue.dataSourceAuthTitle', {
        defaultMessage: 'The data source of the evaluations dataset cannot sign in',
      }),
    unreachable: () =>
      i18n.translate('agentTraces.evalsIssue.unreachableTitle', {
        defaultMessage: 'The cluster of the evaluations dataset is not reachable',
      }),
    'null-groups': () =>
      i18n.translate('agentTraces.evalsIssue.nullGroupsTitle', {
        defaultMessage: 'This cluster drops empty groups from PPL aggregations',
      }),
  };

const ISSUE_BODY: Record<DataIssueView['kind'], (v: { index: string; field?: string }) => string> =
  {
    'dataset-missing': () =>
      i18n.translate('agentTraces.evalsIssue.datasetMissingBody', {
        defaultMessage:
          'The Agent Evaluations settings point to an index pattern that no longer exists. Choose the evaluations dataset again in Settings, or set it up again.',
      }),
    'index-missing': ({ index }) =>
      i18n.translate('agentTraces.evalsIssue.indexMissingBody', {
        defaultMessage:
          'The evaluations dataset reads {index}, and no index on its cluster matches it yet. The index appears with the first result your code sends; Getting started shows how. Or choose another dataset in Settings.',
        values: { index },
      }),
    'no-results': ({ index }) =>
      i18n.translate('agentTraces.evalsIssue.noResultsBody', {
        defaultMessage:
          'The indices behind {index} hold no gen_ai.evaluation.result events. Results appear here a few seconds after your code sends them; Getting started shows how.',
        values: { index },
      }),
    'field-missing': ({ index, field }) =>
      field
        ? i18n.translate('agentTraces.evalsIssue.fieldMissingBody', {
            defaultMessage:
              'The indices behind {index} were created without the evaluation index template (otel-v1-genai-evaluation-index-template), which maps {field} and every other field these views query. Install the template (Getting started shows how); the next index it creates, at the next rollover or result, has the fields. Or choose another dataset in Settings.',
            values: { index, field },
          })
        : i18n.translate('agentTraces.evalsIssue.fieldMissingBodyAny', {
            defaultMessage:
              'The indices behind {index} were created without the evaluation index template (otel-v1-genai-evaluation-index-template), which maps every field these views query. Install the template (Getting started shows how); the next index it creates, at the next rollover or result, has the fields. Or choose another dataset in Settings.',
            values: { index },
          }),
    'data-source': ({ index }) =>
      i18n.translate('agentTraces.evalsIssue.dataSourceBody', {
        defaultMessage:
          'The data source the index pattern {index} reads from was deleted or does not answer. Check it in Data sources, or choose another evaluations dataset in Settings.',
        values: { index },
      }),
    'data-source-auth': ({ index }) =>
      i18n.translate('agentTraces.evalsIssue.dataSourceAuthBody', {
        defaultMessage:
          'The cluster behind the data source of {index} rejected its credentials, or the stored credentials cannot be read. Update the credentials in Data sources, or choose another evaluations dataset in Settings.',
        values: { index },
      }),
    unreachable: ({ index }) =>
      i18n.translate('agentTraces.evalsIssue.unreachableBody', {
        defaultMessage:
          'The cluster that holds {index} did not answer. Check that it is running and reachable, then Refresh.',
        values: { index },
      }),
    'null-groups': () =>
      i18n.translate('agentTraces.evalsIssue.nullGroupsBody', {
        defaultMessage:
          'Agent Evaluations counts results by fields most results leave empty, such as error.type. PPL on this cluster drops those empty groups (plugins.ppl.syntax.legacy.preferred is false), so the counts would leave most results out. Set plugins.ppl.syntax.legacy.preferred to true, the default, to read the results here.',
      }),
  };

const OFFLINE_KINDS: Array<DataIssueView['kind']> = [
  'data-source',
  'data-source-auth',
  'unreachable',
];

/** The one-line title of a data issue (Agent Traces shows it where evaluations would be). */
export const dataIssueTitle = (issue: DataIssueView, index: string): string =>
  ISSUE_TITLE[issue.kind]({ index, field: issue.field });

/**
 * Why the evaluation results cannot be read (`classifyDataIssue`), as an empty state rather than
 * an error: what is missing, and Settings and Getting started to fix it. `compact`: a callout,
 * for a panel of a page.
 */
export const DataIssuePrompt: React.FC<{
  issue: DataIssueView;
  index: string;
  onSettings?: () => void;
  onGettingStarted?: () => void;
  compact?: boolean;
}> = ({ issue, index, onSettings, onGettingStarted, compact }) => {
  const values = { index, field: issue.field };
  const title = ISSUE_TITLE[issue.kind](values);
  const body = ISSUE_BODY[issue.kind](values);
  const testId = `agtEvlDataIssue-${issue.kind}`;
  const actions = (
    <EuiFlexGroup
      gutterSize="s"
      justifyContent={compact ? 'flexStart' : 'center'}
      responsive={false}
      wrap
    >
      {onSettings && (
        <EuiFlexItem grow={false}>
          <EuiButton
            size="s"
            fill={!compact}
            iconType="gear"
            onClick={onSettings}
            data-test-subj="agtEvlDataIssueSettings"
          >
            {i18n.translate('agentTraces.evalsIssue.settings', { defaultMessage: 'Settings' })}
          </EuiButton>
        </EuiFlexItem>
      )}
      {onGettingStarted && (
        <EuiFlexItem grow={false}>
          <EuiButton
            size="s"
            iconType="help"
            onClick={onGettingStarted}
            data-test-subj="agtEvlDataIssueGettingStarted"
          >
            {i18n.translate('agentTraces.evalsIssue.gettingStarted', {
              defaultMessage: 'Getting started',
            })}
          </EuiButton>
        </EuiFlexItem>
      )}
      {(issue.kind === 'no-results' || issue.kind === 'index-missing') && (
        <EuiFlexItem grow={false}>
          <CopyCodingAgentPromptButton data-test-subj="agtEvlDataIssueCopyPrompt" />
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );
  if (compact)
    return (
      <EuiCallOut size="s" color="warning" iconType="help" title={title} data-test-subj={testId}>
        <p>{body}</p>
        {(onSettings || onGettingStarted) && actions}
      </EuiCallOut>
    );
  return (
    <EuiEmptyPrompt
      iconType={OFFLINE_KINDS.includes(issue.kind) ? 'offline' : 'indexClose'}
      title={<h3>{title}</h3>}
      body={
        <EuiText size="s">
          <p>{body}</p>
        </EuiText>
      }
      actions={actions}
      data-test-subj={testId}
    />
  );
};
