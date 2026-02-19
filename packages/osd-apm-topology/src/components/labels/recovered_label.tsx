/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { SliStatusIcon } from '../sli_status_icon';
import { Label } from './label';
import { type LabelProps } from './types';

export const RecoveredLabel = ({ text, children = <SliStatusIcon status="recovered" size={22} /> }: LabelProps) => (
    <Label text={text} className="gap-0.5">
        {children}
    </Label>
);
