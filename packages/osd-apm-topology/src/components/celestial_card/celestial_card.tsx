/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import React, { useCallback, useRef } from 'react';
import { actionsIcon } from '../../shared/resources';
import { useCelestialNodeActionsContext } from '../../shared/contexts/node_actions_context';
import { t } from '../../shared/i18n/t';
import { DEFAULT_METRICS } from '../../shared/constants/common.constants';
import { Description } from '../description';
import { HealthDonut } from '../health_donut';
import { CelestialCardProps } from './types';
import { ViewInsightsButton } from './components/view_insights_button';
import { SliStatus } from './components/sli_status';

export const CelestialCard = (props: CelestialCardProps) => {
    const { id, icon, title, subtitle, platform, health, isGroup, numberOfServices, metrics, isFaded, stackedNodeIds } =
        props;
    const nodeRef = useRef<HTMLDivElement | null>(null);

    const { onGroupToggle, onDashboardClick, selectedNodeId } = useCelestialNodeActionsContext();

    // eslint-disable-next-line no-nested-ternary
    const totalRequests: string = !metrics?.requests
        ? '0'
        : metrics.requests < 1000
            ? `${metrics.requests}`
            : `${Math.round(metrics.requests / 1000).toFixed(1)}k`;

    const isSliStatusDisplayed = health?.status && ['breached', 'recovered'].includes(health?.status);

    // Determine if this card is selected based on context
    const isSelected = id === selectedNodeId;
    const onViewDashboardClick = useCallback(
        (event: React.MouseEvent) => {
            // Selection state is handled by context now
            onDashboardClick?.(event, props);
        },
        [onDashboardClick, props],
    );

    const onDoubleClick = useCallback(
        (event: React.MouseEvent) => {
            if (isGroup) {
                onGroupToggle?.(event, props);
            }
        },
        [onGroupToggle, isGroup, props],
    );

    const isAggregated = (stackedNodeIds?.length ?? 0) > 0;
    return (
        <div
            ref={nodeRef}
            className={`cltCard ${health?.breached ? 'cltCardBreached' : 'cltCardDefault'} ${isSelected ? 'cltCardSelected' : ''} ${isFaded ? 'cltCardFaded' : ''}`}
            onDoubleClick={onDoubleClick}
        >
            <div>
                <div className="grid grid-cols-58">
                    {!!icon && (
                        <div className="col-span-14">
                            <HealthDonut
                                metrics={metrics || { ...DEFAULT_METRICS }}
                                size={60}
                                icon={icon}
                                isLegendEnabled={true}
                            />
                        </div>
                    )}

                    {/* Rest of the component remains unchanged */}
                    <div className={`col-span-44 flex flex-col justify-center ${isSliStatusDisplayed ? '-mt-2' : ''}`}>
                        {isSliStatusDisplayed && (
                            <div className="col-span-44 flex flex-row-reverse mb-0.5">
                                <SliStatus status={health?.status} />
                            </div>
                        )}
                        {isGroup ? (
                            <div
                                className="flex items-center group hover:cursor-pointer pl-1"
                                onClick={(e) => onGroupToggle?.(e, props)}
                            >
                                <button
                                    className="text-group-caret transition-colors mr-0 bg-transparent border-0 p-0"
                                    aria-expanded={false}
                                >
                                    <img src={actionsIcon} alt="Actions" className="cltIconSm cltActionsIcon cltIconThemed" />
                                </button>
                                <a className="font-bold text-sm text-link-default hover:text-link-hover transition-colors truncate">
                                    {title}
                                </a>
                            </div>
                        ) : (
                            <div className="font-bold text-sm text-body-default transition-colors pl-2 truncate">
                                {title}
                            </div>
                        )}
                        <div className="text-xs text-body-secondary pl-2 truncate">{subtitle}</div>
                    </div>
                </div>
                {!isAggregated && (
                    <div className="grid grid-cols-58 cltCardMetrics">
                        <div className="col-span-16">
                            <Description className="pr-1" label={t('node.labels.requests')} value={totalRequests} />
                        </div>

                        {/* Rest of the component remains unchanged */}
                        <div className="col-span-42 flex flex-col justify-center border-l-1 border-divider-default">
                            {isGroup || platform ? (
                                <Description
                                    className="pl-2.5"
                                    label={isGroup ? t('node.labels.services') : t('node.labels.platform')}
                                    value={isGroup ? `${numberOfServices}` : platform!}
                                />
                            ) : (
                                <div className="flex flex-row-reverse flex-grow text-xs items-end">
                                    <ViewInsightsButton onClick={onViewDashboardClick} />
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {(isGroup || platform) && !isAggregated && (
                    <div className="flex flex-row-reverse text-xs">
                        <ViewInsightsButton onClick={onViewDashboardClick} />
                    </div>
                )}
            </div>
        </div>
    );
};
