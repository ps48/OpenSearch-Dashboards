/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { type Edge, type Node } from '@xyflow/react';
import { ReactNode } from 'react';
import { type CelestialCardProps } from './components/celestial_card';
import { type LayoutOptions } from './shared/hooks/use_celestial_layout.hook';
import { Breadcrumb } from './components';

export type CelestialNode = Node<CelestialCardProps>;
export type CelestialEdge = Edge;

export type CelestialNodes = CelestialNode[];
export type CelestialEdges = CelestialEdge[];

export type CelestialMapModel = {
    nodes: CelestialNodes;
    edges: CelestialEdges;
};

export interface CelestialMapProps {
    map: { [groupId: string]: CelestialMapModel };
    nodesInFocus?: CelestialNode[];
    isLoading?: boolean;
    onGroupBy?: (event: any, detail: any) => void;
    onDashboardClick?: (node?: CelestialCardProps) => void;
    onDataFetch?: (node?: CelestialCardProps) => void;
    layoutOptions?: LayoutOptions;
    onEdgeClick?: (edge: CelestialEdge) => void;
    emptyState?: ReactNode;
    breadcrumbHotspot?: ReactNode;
    breadcrumbs?: Breadcrumb[];
    onBreadcrumbClick?: (Breadcrumb: Breadcrumb, index: number) => void;
    navigateToBreadcrumb?: (index: number) => void;
    addBreadcrumb?: (title: string, node?: CelestialCardProps) => void;
    numMatchesForFilters?: number;
    selectedNodeId?: string;
    topN?: number;
}
