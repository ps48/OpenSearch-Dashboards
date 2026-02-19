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
        <div className="flex flex-col gap-2 bg-container-default text-body-secondary p-2 rounded-full shadow-md dark:shadow-md z-50">
            <button
                type="button"
                onClick={onLayoutChange}
                className="w-6 h-6 flex items-center justify-center hover:text-interactive transition-all cursor-pointer"
                title={t('controls.layout')}
                aria-label={t('controls.layout')}
            >
                <img src={layoutIcon} alt="Layout" className="cltIconSm" />
            </button>
            <button
                type="button"
                onClick={onExpandAll}
                className="w-6 h-6 flex items-center justify-center hover:text-interactive transition-all cursor-pointer"
                title={t('controls.expandAll')}
                aria-label={t('controls.expandAll')}
            >
                <img src={expandAllIcon} alt="Expand All" className="cltIconSm" />
            </button>
        </div>
    );
};
