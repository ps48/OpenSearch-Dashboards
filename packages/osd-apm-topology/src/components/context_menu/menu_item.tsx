/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { type MenuItemProps } from './types';

export const MenuItem = ({ label, isDisabled, onClick }: MenuItemProps) => (
    <li key={label}>
        <button
            onClick={onClick}
            disabled={isDisabled}
            className="cltContextMenuItem"
        >
            {label}
        </button>
    </li>
);
