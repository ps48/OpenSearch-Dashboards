/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { useRef } from 'react';
import { t } from '../../shared/i18n/t';
import { useOnClickOutside } from '../../shared/hooks/use_on_click_outside.hook';
import { closeIcon } from '../../shared/resources';
import { ErrorsLabel, RecoveredLabel, BreachedLabel, FaultsLabel, OkLabel } from '../labels';
import { HealthDonut } from '../health_donut';
import { LegendPanelProps } from './types';

export const LegendPanel: React.FC<LegendPanelProps> = ({ onClose }) => {
    const legendRef = useRef<HTMLDivElement>(null);

    // closes menu if user clicks outside of the node
    useOnClickOutside(legendRef, onClose);

    return (
        <div ref={legendRef} className="cltLegendPanel">
            <div className="p-4 grid gap-3 text-body-secondary">
                <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm">{t('legend.title')}</h3>
                    <button onClick={onClose} className="hover:text-interactive cursor-pointer">
                        <img src={closeIcon} alt="Close" className="cltIcon cltIconThemed" />
                    </button>
                </div>
                <div className="flex justify-center items-center py-2">
                    <HealthDonut metrics={{ requests: 100, faults5xx: 35, errors4xx: 25 }} size={60}></HealthDonut>
                </div>
                <ul className="grid gap-2">
                    <li>
                        <FaultsLabel text={t('legend.faults')} />
                    </li>
                    <li>
                        <ErrorsLabel text={t('legend.errors')} />
                    </li>
                    <li>
                        <OkLabel text={t('legend.ok')} />
                    </li>
                </ul>
                <ul className="grid gap-0.5 -ml-0.5">
                    <li>
                        <BreachedLabel text={t('legend.activeSLIBreach')} />
                    </li>
                    <li>
                        <RecoveredLabel text={t('legend.recoveredSLI')} />
                    </li>
                </ul>
            </div>
        </div>
    );
};
