/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { t, TId } from '../../../shared/i18n/t';
import { Label } from '../../labels/Label';
import { SliStatusIcon } from '../../sli_status_icon';

export interface SliStatusProps {
    status: string;
}
export const SliStatus = ({ status }: SliStatusProps) => {
    const isBreached = status === 'breached';
    return (
        <Label
            text={t(`node.sliStatus.${status}` as TId)}
            className={`gap-0.5 ${isBreached ? 'text-faults' : 'text-errors'}`}
        >
            <SliStatusIcon status={status} size={16} />
        </Label>
    );
};