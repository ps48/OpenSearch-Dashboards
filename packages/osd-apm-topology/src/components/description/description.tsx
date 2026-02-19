/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { DescriptionProps } from './types';

export const Description = (props: DescriptionProps) => (
    <div className={props.className}>
        <div className="text-xs text-body-default">{props.label}</div>
        <div className="text-xs text-body-secondary">{props.value} </div>
    </div>
);
