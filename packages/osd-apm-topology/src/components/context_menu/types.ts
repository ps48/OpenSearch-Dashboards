/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


export interface MenuItemProps {
    label: string;
    isDisabled?: boolean;
    onClick: (event: React.MouseEvent) => void;
}

export type ContextMenuProps = {
    nodeId: string;
    onClose: () => void;
};
