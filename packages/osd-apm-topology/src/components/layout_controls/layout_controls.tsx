/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { expandAllIcon, layoutIcon } from '../../shared/resources';
import { t } from '../../shared/i18n/t';
import { useLayoutControls } from './use_layout_controls.hook';
/**
 * Control buttons for zooming and fitting the Celestial map view
 */
export const LayoutControls = () => {
    const { onLayoutChange, onExpandAll } = useLayoutControls();

    // Create direct references to the button elements
    return (
        <div className="cltControlPanel">
            <button
                type="button"
                onClick={onLayoutChange}
                className="cltControlBtn"
                title={t('controls.layout')}
                aria-label={t('controls.layout')}
            >
                <img src={layoutIcon} alt="Layout" className="cltIconSm cltIconThemed" />
            </button>
            <button
                type="button"
                onClick={onExpandAll}
                className="cltControlBtn"
                title={t('controls.expandAll')}
                aria-label={t('controls.expandAll')}
            >
                <img src={expandAllIcon} alt="Expand All" className="cltIconSm cltIconThemed" />
            </button>
        </div>
    );
};
