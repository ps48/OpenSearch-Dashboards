/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ICONS } from '../constants/icons.constants';
import { serviceLensUnknownNodeIcon } from '../resources/services';

export const getIcon = (type: string): JSX.Element => {
    const iconUrl = ICONS?.[type];
    if (iconUrl) {
        return <img src={iconUrl} alt={type} className="cltIcon" />;
    }
    return <img src={serviceLensUnknownNodeIcon} alt="Unknown" className="cltIcon" />;
};
