/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  EuiBetaBadge,
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import type { EvaluationsServices } from '.';

export const SETTINGS_LABEL = i18n.translate('agentTraces.evalsPage.settings', {
  defaultMessage: 'Settings',
});

export const EvalSettingsButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <EuiButtonEmpty iconType="gear" size="s" onClick={onClick} data-test-subj="agtEvlSettingsButton">
    {SETTINGS_LABEL}
  </EuiButtonEmpty>
);

export const GETTING_STARTED_LABEL = i18n.translate('agentTraces.evalsPage.gettingStarted', {
  defaultMessage: 'Getting started',
});

export const EvalGettingStartedButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <EuiButtonEmpty
    iconType="help"
    size="s"
    onClick={onClick}
    data-test-subj="agtEvlGettingStartedButton"
  >
    {GETTING_STARTED_LABEL}
  </EuiButtonEmpty>
);

/** Next to the page title: the feature is experimental (hover for what that means). */
export const ExperimentalBadge: React.FC = () => (
  <EuiBetaBadge
    label={i18n.translate('agentTraces.evalsPage.experimental', {
      defaultMessage: 'Experimental',
    })}
    iconType="navExperiments"
    size="s"
    tooltipContent={i18n.translate('agentTraces.evalsPage.experimentalTip', {
      defaultMessage:
        'Agent Evaluations is experimental. Screens, fields and the data model may change in a future release.',
    })}
    data-test-subj="agtEvlExperimental"
  />
);

/**
 * The page's controls (date picker, Settings) on the application header's right, on the
 * breadcrumb's row, as the APM pages mount theirs (`HeaderControl` with
 * `setAppRightControls`). With the legacy navigation there is no such slot: the title,
 * the description and the controls make a row at the top of the page.
 */
export const EvalHeader: React.FC<{
  title: string;
  description: React.ReactNode;
  controls: React.ReactElement[];
}> = ({ title, description, controls }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const HeaderControl = services.navigation?.ui?.HeaderControl;
  const inHeader = !!services.chrome.navGroup?.getNavGroupEnabled() && !!HeaderControl;
  if (inHeader && HeaderControl) {
    return (
      <>
        <HeaderControl
          setMountPoint={services.application.setAppBadgeControls}
          controls={[{ renderComponent: <ExperimentalBadge /> }]}
        />
        <HeaderControl
          setMountPoint={services.application.setAppRightControls}
          controls={controls.map((renderComponent) => ({ renderComponent }))}
        />
      </>
    );
  }
  return (
    <EuiFlexGroup
      alignItems="center"
      justifyContent="spaceBetween"
      wrap
      data-test-subj="agtEvlInPageHeader"
    >
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiTitle size="m">
              <h1>{title}</h1>
            </EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <ExperimentalBadge />
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiText size="s" color="subdued">
          {description}
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          {controls.map((c) => (
            <EuiFlexItem grow={false} key={c.key ?? undefined}>
              {c}
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
