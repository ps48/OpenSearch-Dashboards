/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { zoomInIcon, zoomOutIcon, fitViewIcon } from '../../shared/resources';
import { t } from '../../shared/i18n/t';
import { useCelestialControls } from './use_celestial_controls.hook';
/**
 * Control buttons for zooming and fitting the Celestial map view
 */
export const CelestialControls = () => {
    const { onZoomIn, onZoomOut, onFitView } = useCelestialControls();

    // Create direct references to the button elements
    return (
        <div className="cltControlPanel">
            <button
                type="button"
                onClick={onZoomIn}
                className="cltControlBtn"
                title={t('controls.zoomIn')}
                aria-label={t('controls.zoomIn')}
            >
                <img src={zoomInIcon} alt="Zoom In" className="cltIconSm cltIconThemed" />
            </button>
            <button
                type="button"
                onClick={onFitView}
                className="cltControlBtn"
                title={t('controls.fitView')}
                aria-label={t('controls.fitView')}
            >
                <img src={fitViewIcon} alt="Fit View" className="cltIconSm cltIconThemed" />
            </button>
            <button
                type="button"
                onClick={onZoomOut}
                className="cltControlBtn"
                title={t('controls.zoomOut')}
                aria-label={t('controls.zoomOut')}
            >
                <img src={zoomOutIcon} alt="Zoom Out" className="cltIconSm cltIconThemed" />
            </button>
        </div>
    );
};
