/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import '../../_celestial.scss';
import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import { useCallback, useRef } from 'react';
import { useContextMenu } from '../../shared/hooks/use_context_menu.hook';
import { useCelestialStateContext } from '../../shared/contexts/celestial_state_context';
import { t } from '../../shared/i18n/t';
import { useNodeClustering } from '../../shared/hooks/use_node_clustering.hook';
import { useNodeRelationships, Visibility } from '../../shared/hooks/use_node_relationships.hook';
import { type CelestialCardProps } from '../celestial_card/types';
import { CelestialCard } from '../celestial_card/celestial_card';
import { StackWrapper } from '../stack_wrapper';
import { ContextMenu } from '../context_menu';
import { Portal } from '../portal';
import { useContextMenuActions } from '../context_menu/use_context_menu_actions.hook';

export type CelestialCustomNode = Node<CelestialCardProps, string>;

export const CelestialNode = ({ data, id }: NodeProps<CelestialCustomNode>) => {
    const { hasOutgoingEdges, getAggregateSiblingsCount, getOutgoingEdgesCount, hasChildren, getChildrenNodes } =
        useNodeRelationships();

    const { isCollapsed, isCollapsable, isStacked, isStackable, isExpanded, isExpandable } = useNodeClustering();
    const { onExpandChildren, onExpandSiblings, onCollapseSiblings, onCollapseDescendants } = useContextMenuActions(id);
    const count = data.isStacked ? getAggregateSiblingsCount(id) + 1 : getOutgoingEdgesCount(id, Visibility.Hidden);

    // Ref for the node container, used for context menu positioning
    const nodeRef = useRef<HTMLDivElement | null>(null);
    const { activeMenuNodeId, setActiveMenuNodeId } = useCelestialStateContext();
    const { isMenuOpen, onClose, onToggleMenu, menuPosition } = useContextMenu({
        id,
        nodeRef,
        activeMenuNodeId,
        setActiveMenuNodeId,
    });

    /**
     * Determines if the action button (+/-) should be visible for a node
     * Button is shown when node can be unstacked, stacked, or has outgoing edges to manage
     */
    const isActionButtonVisible = useCallback(
        (nodeId: string): boolean => {
            return isStacked(nodeId) || isStackable(nodeId) || hasOutgoingEdges(nodeId);
        },
        [isStacked, isStackable, hasOutgoingEdges],
    );

    /**
     * Determines the symbol (+/-) to display on the action button
     * '-' indicates the node can be collapsed/stacked (currently expanded/unstacked)
     * '+' indicates the node can be expanded/unstacked (currently collapsed/stacked)
     */
    const getActionButtonSymbol = useCallback(
        (nodeId: string): string => {
            if (
                isExpanded(nodeId) ||
                isStackable(nodeId) ||
                (isCollapsable(nodeId) && getChildrenNodes(nodeId, Visibility.Hidden).every((n) => n.data.isStacked))
            ) {
                return '-';
            }

            return '+';
        },
        [isStacked, isExpanded],
    );

    /**
     * Determines if the StackWrapper should be used to visually indicate hidden children
     *
     * StackWrapper is shown when:
     * - Node is currently stacked
     * - Node is collapsable/expandable with hidden children that aren't all stacked
     * - Node is collapsed with hidden children but no visible children
     *
     * This creates the visual "stacked cards" effect to indicate grouped/hidden nodes
     */
    const isStackedWrapperShown = useCallback(
        (nodeId: string) => {
            if (isStacked(nodeId)) return true;

            if (isCollapsable(nodeId) && hasChildren(nodeId, Visibility.Hidden)) {
                return !getChildrenNodes(nodeId, Visibility.Hidden).every((n) => n.data.isStacked);
            }

            if (isExpandable(nodeId) && hasChildren(nodeId, Visibility.Hidden)) {
                return !getChildrenNodes(nodeId, Visibility.Hidden).every((n) => n.data.isStacked);
            }

            if (isCollapsed(nodeId)) {
                return hasChildren(nodeId, Visibility.Hidden) && !hasChildren(nodeId, Visibility.Visible);
            }

            return false;
        },
        [isCollapsed, isStacked, isCollapsable, hasChildren, isExpandable],
    );

    /**
     * Returns the appropriate click handler for the action button based on node state
     *
     * Handler priority:
     * 1. Stacked nodes -> expand siblings (unstack)
     * 2. Stackable nodes -> collapse siblings (stack)
     * 3. Expanded nodes -> collapse descendants
     * 4. Collapsed nodes -> expand children
     * 5. Default -> toggle context menu
     */
    const getActionButtonHandler = useCallback(
        (nodeId: string) => {
            if (isStacked(nodeId)) return onExpandSiblings;

            if (isStackable(nodeId)) return onCollapseSiblings;

            if (isExpanded(nodeId)) return onCollapseDescendants;

            if (isCollapsed(nodeId)) return onExpandChildren;

            return onToggleMenu;
        },
        [isStacked, isStackable, isExpanded, isCollapsed],
    );

    /**
     * Action button element for node state management
     * Conditionally rendered based on node capabilities (stacking, expansion, etc.)
     * Button is either integrated into StackWrapper or positioned independently
     */
    const buttonElement = isActionButtonVisible(id) ? (
        <button
            className="w-8 h-8 rounded-full border border-blue-400 bg-blue-100 flex items-center justify-center text-sm font-bold cursor-pointer z-10 shadow-sm hover:border-blue-600 transition-colors text-blue-800"
            onClick={getActionButtonHandler(id)}
            title={t('node.showNodeActions')}
        >
            {getActionButtonSymbol(id)}
        </button>
    ) : null;

    return (
        <div className="relative inline-block" ref={nodeRef}>
            {/* 
                Conditional rendering based on node state:
                - StackWrapper: Used when node has hidden children to show visual stacking effect
                - Direct rendering: Used for simple nodes without hidden children
            */}
            {isStackedWrapperShown(id) ? (
                <StackWrapper hiddenChildrenCount={count} button={buttonElement} isFaded={!!data.isFaded}>
                    <CelestialCard {...data} />
                </StackWrapper>
            ) : (
                <div className="relative">
                    <CelestialCard {...data} />
                    {/* Action button positioned to the right when not using StackWrapper */}
                    {buttonElement && <div className="absolute -right-4 top-1/2 -translate-y-1/2">{buttonElement}</div>}
                </div>
            )}

            {/* Context menu portal - rendered when menu is open and positioned */}
            {isMenuOpen && menuPosition && (
                <Portal position={menuPosition}>
                    <ContextMenu nodeId={id} onClose={onClose} />
                </Portal>
            )}

            <Handle type="source" position={Position.Right} id="source-right" />
            <Handle type="source" position={Position.Left} id="source-left" />
            <Handle type="source" position={Position.Bottom} id="source-bottom" />
            <Handle type="source" position={Position.Top} id="source-top" />
            <Handle type="target" position={Position.Right} id="target-right" />
            <Handle type="target" position={Position.Left} id="target-left" />
            <Handle type="target" position={Position.Bottom} id="target-bottom" />
            <Handle type="target" position={Position.Top} id="target-top" />
        </div>
    );
};
