/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


export const HEALTH_DONUT_COLORS = {
    background: 'var(--color-requests)',
    white: 'var(--color-container-default)',
    ok2xx: 'var(--color-ok)',
    okFill: 'var(--color-ok)',
    error4xx: 'var(--color-errors)',
    errorFill: '#8a6b05', // @todo - convert colors to css colors
    fault5xx: 'var(--color-faults)',
    faultFill: 'var(--color-faults)',
} as const;

export enum HEALTH_DONUT_STATUS {
    OK = 'ok',
    FAULT = 'fault',
    ERROR = 'error',
}
