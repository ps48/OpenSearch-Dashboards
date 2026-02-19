/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import React, { useRef } from 'react';
import { useNodeRelationships, Visibility } from '../../shared/hooks/use_node_relationships.hook';
import { t } from '../../shared/i18n/t';
import { useOnClickOutside } from '../../shared/hooks/use_on_click_outside.hook';
import { type ContextMenuProps } from './types';
import { MenuItem } from './menu_item';
import { useContextMenuActions } from './use_context_menu_actions.hook';

const ContextMenu: React.FC<ContextMenuProps> = ({ nodeId, onClose }) => {
    const menuRef = useRef<HTMLUListElement>(null);

    const { hasOutgoingEdges } = useNodeRelationships();

    // closes menu if user clicks outside of the node
    useOnClickOutside(menuRef, onClose);

    const { onExpandChildren, onCollapseDescendants } = useContextMenuActions(nodeId, onClose);

    return (
        <ul
            ref={menuRef}
            className="absolute z-9999 overflow-visible bg-white border border-gray-200 rounded shadow-md w-60"
        >
            <MenuItem
                label={t('contextMenu.expandDependencies')}
                isDisabled={!hasOutgoingEdges(nodeId, Visibility.Hidden)}
                onClick={onExpandChildren}
            />
            <MenuItem
                label={t('contextMenu.collapseDependencies')}
                isDisabled={!hasOutgoingEdges(nodeId, Visibility.Visible)}
                onClick={onCollapseDescendants}
            />
        </ul>
    );
};
export default ContextMenu;
