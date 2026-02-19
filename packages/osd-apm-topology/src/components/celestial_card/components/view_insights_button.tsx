/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { HTMLAttributes } from 'react';
import { t } from '../../../shared/i18n/t';

export const ViewInsightsButton: React.FC<HTMLAttributes<HTMLButtonElement>> = (props) => (
    <button
        className="font-medium text-link-default hover:text-link-hover cursor-pointer"
        aria-label={t('buttons.viewInsights')}
        title={t('buttons.viewInsights')}
        {...props}
    >
        {t(`buttons.viewInsights`)}
    </button>
);
