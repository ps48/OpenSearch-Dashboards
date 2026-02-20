/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import React from 'react';
import { legendIcon } from '../../shared/resources';
import { t } from '../../shared/i18n/t';
import { LegendPanel } from './legend_panel';
import { Portal } from '../portal';
import { useLegend } from './hooks/use_legend.hook';

export const Legend: React.FC = () => {
    const { ref, isOpen, position, onClose, onToggle } = useLegend();

    return (
        <>
            {/* Legend Icon Button */}
            <button
                ref={ref}
                onClick={onToggle}
                className="cltLegendBtn"
                aria-label={t(`legend.toggle`)}
            >
                <img src={legendIcon} alt="Legend" className="cltIcon cltIconThemed" />
            </button>

            {/* Legend Popup */}
            {isOpen && (
                <Portal position={position ?? {}}>
                    <LegendPanel onClose={onClose} />
                </Portal>
            )}
        </>
    );
};
