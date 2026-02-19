/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { FaultsSwatch } from '../swatches/faults_swatch';
import { Label } from './label';
import { type LabelProps } from './types';

export const FaultsLabel = ({ text, children = <FaultsSwatch /> }: LabelProps) => (
    <Label text={text} className="gap-1.5">
        {children}
    </Label>
);
