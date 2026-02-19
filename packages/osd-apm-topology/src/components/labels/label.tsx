/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { LabelProps } from './types';

export const Label = ({ text, className, children }: LabelProps) => (
    <div className={`flex items-center text-body-secondary ${className}`}>
        <div className="flex items-center">{children}</div>
        <div className="flex text-xs">{text}</div>
    </div>
);
