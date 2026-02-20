/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import React from 'react';
import { StackWrapperProps } from './types';

export const StackWrapper: React.FC<StackWrapperProps> = ({
    children,
    hiddenChildrenCount,
    stackSpacing = 6,
    maxVisibleStacks = 2,
    button,
    isFaded,
}) => {
    // Create array for background stack layers
    const stackElements = Array.from({ length: maxVisibleStacks }, (_, index) => index + 1);

    return (
        <div className="relative">
            {/* Background stack layers */}
            <div className="grid relative">
                {stackElements.map((i) => (
                    <div
                        key={i}
                        className="col-start-1 row-start-1 w-68 min-h-24 rounded-xl border-2 border-solid border-status-default bg-container-default/50"
                        style={{
                            transform: `translate(-${i * stackSpacing}px, -${i * stackSpacing}px)`,
                            zIndex: maxVisibleStacks - i,
                            opacity: isFaded ? '0.3' : '1',
                        }}
                        aria-hidden="true"
                    />
                ))}

                {/* Main content (CelestialCard) */}
                <div
                    className="col-start-1 row-start-1"
                    style={{
                        zIndex: maxVisibleStacks + 1,
                    }}
                >
                    {children}
                </div>
            </div>

            {/* Hidden children count badge */}
            <div
                className="cltStackBadge"
                style={{
                    zIndex: maxVisibleStacks + 2,
                }}
                title={`${hiddenChildrenCount} hidden children`}
                role="status"
                aria-label={`${hiddenChildrenCount} hidden children`}
            >
                +{hiddenChildrenCount}
            </div>

            {/* Expand/Collapse Button - positioned relative to StackWrapper */}
            {button && (
                <div
                    className="absolute top-1/2 -translate-y-1/2"
                    style={{
                        right: '-16px', // -right-4 equivalent
                        zIndex: maxVisibleStacks + 2,
                    }}
                >
                    {button}
                </div>
            )}
        </div>
    );
};
