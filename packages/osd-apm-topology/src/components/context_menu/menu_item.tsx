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
            className={`
                block w-full text-left px-4 py-2 text-sm whitespace-nowrap
                ${isDisabled ? 'cursor-not-allowed text-gray-400 hover:bg-white' : 'hover:bg-gray-100'}
            `}
        >
            {label}
        </button>
    </li>
);
