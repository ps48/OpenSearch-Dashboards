/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { type AbsolutePositionProps } from './types';
import './_absolute_position.scss';

export const AbsolutePosition: React.FC<AbsolutePositionProps> = ({ children, ...positioning }) => (
    <div className="celAbsolute" style={{ ...positioning }}>
        {children}
    </div>
);
