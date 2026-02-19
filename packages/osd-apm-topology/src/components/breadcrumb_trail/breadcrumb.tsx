/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { dividerIcon } from '../../shared/resources';
import { PropsWithChildren } from 'react';

export interface BreadcrumbProps {
    title: string;
    onBreadcrumbClick?: (event: React.MouseEvent) => void;
}

export const Breadcrumb = ({ title, onBreadcrumbClick, children }: PropsWithChildren<BreadcrumbProps>) => (
    <span className="cltBreadcrumbItem">
        {children}
        {!onBreadcrumbClick ? (
            <span className="cltBreadcrumbTitle">{title}</span>
        ) : (
            <button
                onClick={onBreadcrumbClick}
                className="cltBreadcrumbLink"
            >
                {title}
            </button>
        )}
        {onBreadcrumbClick && (
            <span className="cltBreadcrumbDivider">
                <img src={dividerIcon} alt="" className="cltIconSm" />
            </span>
        )}
    </span>
);
