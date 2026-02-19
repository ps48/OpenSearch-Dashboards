/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import React from 'react';
import { t } from '../../shared/i18n/t';
import { alarmIcon } from '../../shared/resources';
import './_sli_status_icon.scss';
import { type SliStatusIconProps } from './types';

export const SLI_STATUS_ICON_TEST_ID = (status: string) => `sli-status-icon-${status}`;

export const SliStatusIcon: React.FC<SliStatusIconProps> = ({ status, size, isPulsing = false }) => (
    <div
        data-testid={SLI_STATUS_ICON_TEST_ID(status)}
        className={`celSliStatusIcon ${status === 'breached' ? 'celBreached' : status === 'recovered' ? 'celRecovered' : ''} ${isPulsing ? 'celAnimated' : ''}`}
        style={{
            width: `${size}px`,
            height: `${size}px`,
        }}
        role="img"
        aria-label={t(`sliStatus`)}
    >
        <img src={alarmIcon} alt="Alarm" style={{ height: size, width: size }} />
    </div>
);
