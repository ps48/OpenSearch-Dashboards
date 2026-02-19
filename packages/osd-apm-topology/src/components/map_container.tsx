/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { Edge, Node, OnEdgesChange, OnNodesChange, ReactFlow } from '@xyflow/react';
import React, { ReactNode } from 'react';
import { type CelestialEdge } from '../types';
import { Breadcrumb, BreadcrumbTrail } from './breadcrumb_trail';
import { type CelestialCardProps } from './celestial_card/types';
import { CelestialControls } from './celestial_controls';
import { LayoutControls } from './layout_controls';
import { CelestialNode } from './celestial_node';
import { GlassBackground } from './glass_background';
import { Legend } from './legend';
import { Loader } from './loader/loader';
import { t } from '../shared/i18n/t';

const nodeTypes = {
    celestialNode: CelestialNode,
};

interface MapContainerProps {
    nodes: Node<CelestialCardProps>[];
    edges: Edge[];
    onNodesChange: OnNodesChange<Node<CelestialCardProps>>;
    onEdgesChange: OnEdgesChange<Edge>;
    isLoading?: boolean;
    breadcrumbs: Breadcrumb[];
    onBreadcrumbClick: (breadcrumb: Breadcrumb, index: number) => void;
    onEdgeClick: (event: any, edge: CelestialEdge) => void;
    emptyState?: ReactNode;
    hotspot?: ReactNode;
    numMatches?: number;
}

export const MapContainer: React.FC<MapContainerProps> = ({
    nodes,
    edges,
    isLoading,
    onNodesChange,
    onEdgesChange,
    breadcrumbs,
    onBreadcrumbClick,
    onEdgeClick,
    emptyState,
    hotspot,
    numMatches,
}) => (
    <div
        // eslint-disable-next-line max-len
        className={`flex flex-col h-full overflow-hidden rounded-2xl relative`}
    >
        <div className="absolute top-2 left-0 flex z-1000">
            <BreadcrumbTrail breadcrumbs={breadcrumbs} onBreadcrumbClick={onBreadcrumbClick} hotspot={hotspot} />
        </div>
        {numMatches !== undefined && (
            <div className="absolute top-[14px] right-4 flex z-1000">
                <div className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm bg-blue-50 text-black border-2 border-blue-500">
                    {numMatches} {numMatches === 1 ? t('matchForFilter') : t('matchesForFilter')}
                </div>
            </div>
        )}
        <div className="relative flex-grow">
            {isLoading && (
                <GlassBackground>
                    <Loader />
                </GlassBackground>
            )}
            {!isLoading && nodes?.length === 0 && (
                <div className="bg-container-default absolute inset-0 flex items-center justify-center z-10">
                    {emptyState}
                </div>
            )}
            {/* Controls and Legend stacked in top-right corner - moved outside ReactFlow */}
            <div className="absolute top-15 right-4 flex flex-col items-center gap-4 z-50">
                <Legend />
                <CelestialControls />
                <LayoutControls />
            </div>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onEdgeClick={onEdgeClick}
                minZoom={0}
                fitView
                nodeTypes={nodeTypes}
                proOptions={{ hideAttribution: true }}
                className="w-full h-full z-1"
            />
        </div>
    </div>
);
