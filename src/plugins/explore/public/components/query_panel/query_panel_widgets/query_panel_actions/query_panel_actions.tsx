/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import { EuiButtonEmpty, EuiIcon, EuiListGroup, EuiPopover, EuiText } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../../../opensearch_dashboards_react/public';
import {
  ButtonActionConfig,
  FlyoutActionConfig,
  QueryPanelActionsRegistryService,
  QueryPanelActionConfig,
} from '../../../../services/query_panel_actions_registry';
import { ExploreServices } from '../../../../types';
import { useQueryPanelActionDependencies } from './use_query_panel_action_dependencies';
import './query_panel_actions.scss';

export interface QueryPanelActionsProps {
  registry: QueryPanelActionsRegistryService;
}

export const QueryPanelActions = ({ registry }: QueryPanelActionsProps) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeFlyoutId, setActiveFlyoutId] = useState<string | null>(null);

  const { services } = useOpenSearchDashboards<ExploreServices>();

  // Get all dependencies for actions
  const dependencies = useQueryPanelActionDependencies();

  const onButtonClick = () => setIsPopoverOpen(!isPopoverOpen);
  const closePopover = () => setIsPopoverOpen(false);

  // Close flyout handler
  const closeFlyout = useCallback(() => {
    setActiveFlyoutId(null);
  }, []);

  // Handle action click
  const handleActionClick = useCallback(
    (action: QueryPanelActionConfig) => {
      if (action.actionType === 'button') {
        const buttonAction = action as ButtonActionConfig;
        buttonAction.onClick(dependencies);
      } else if (action.actionType === 'flyout') {
        const flyoutAction = action as FlyoutActionConfig;
        // Call onOpen callback if provided
        flyoutAction.onOpen?.(dependencies);
        // Set active flyout
        setActiveFlyoutId(action.id);
        // Close the popover
        closePopover();
      }
    },
    [dependencies]
  );

  // Get active flyout config
  const activeFlyout = useMemo(() => {
    if (!activeFlyoutId) return null;
    const action = registry.getAction(activeFlyoutId);
    return action?.actionType === 'flyout' ? (action as FlyoutActionConfig) : null;
  }, [activeFlyoutId, registry]);

  return (
    <>
      <EuiPopover
        button={
          <EuiButtonEmpty
            onClick={onButtonClick}
            data-test-subj="queryPanelFooterActionsButton"
            size="xs"
          >
            <div className="exploreQueryPanelActions__buttonTextWrapper">
              <EuiText size="xs">
                {i18n.translate('explore.queryPanel.actions.actions', {
                  defaultMessage: 'Actions',
                })}
              </EuiText>
              <EuiIcon type="arrowDown" size="s" />
            </div>
          </EuiButtonEmpty>
        }
        isOpen={isPopoverOpen}
        closePopover={closePopover}
        anchorPosition="downCenter"
        panelPaddingSize="none"
      >
        <EuiListGroup>
          {registry.getSortedActions().map((action) => {
            const isEnabled = action.getIsEnabled ? action.getIsEnabled(dependencies) : true;
            const label = action.getLabel(dependencies);
            const icon = action.getIcon?.(dependencies);

            return (
              <EuiButtonEmpty
                key={action.id}
                className="exploreQueryPanelActions__item"
                onClick={() => handleActionClick(action)}
                disabled={!isEnabled}
                iconType={icon}
              >
                {label}
              </EuiButtonEmpty>
            );
          })}
        </EuiListGroup>
      </EuiPopover>

      {/* Render active flyout */}
      {activeFlyout && (
        <activeFlyout.component
          closeFlyout={closeFlyout}
          dependencies={dependencies}
          services={services}
        />
      )}
    </>
  );
};
