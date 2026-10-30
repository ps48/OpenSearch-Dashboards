/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { EuiEmptyPrompt, EuiLoadingSpinner, EuiSpacer, EuiText } from '@elastic/eui';
import { FormattedMessage } from '@osd/i18n/react';
// @ts-expect-error TS7016 TODO(ts-error): fixme
import { CelestialMap, AgentCardNode } from '@osd/apm-topology';
import { useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

import { TraceRow } from '../hooks/tree_utils';
import { categorizeSpanTree, CategorizedSpan } from '../../../../services/span_categorization';
import { spansToFlow } from '../../../../services/flow_transform';
import './trace_flow_view.scss';

/** Extra marks on one node (e.g. a trace comparison): a class on its wrapper and a badge. */
export interface NodeDecoration {
  className?: string;
  badge?: React.ReactNode;
}

interface TraceFlowViewProps {
  spanTree: TraceRow[];
  totalDuration: number;
  selectedSpan: TraceRow | null;
  onSelectSpan: (span: TraceRow | null) => void;
  isLoading?: boolean;
  loadError?: string;
  /** Marks per span; without it nodes render as in the trace flyout. */
  decorateNode?: (span: CategorizedSpan) => NodeDecoration | undefined;
  /** The minimap (default on); off for maps shown side by side. */
  showMinimap?: boolean;
  /**
   * Opens centered on this span at `initialZoom` (default 1, labels legible) instead of fitting
   * the whole trace; Fit view still fits it.
   */
  initialFocusSpanId?: string;
  initialZoom?: number;
}

/** The map fits its contents 100 ms after the layout, animated over 400 ms: center after it. */
export const INITIAL_FOCUS_DELAY_MS = 600;

// Context for passing span selection handler to custom node components
interface TraceFlowContextValue {
  onSelectSpan: (span: TraceRow | null) => void;
  spanMap: Map<string, CategorizedSpan>;
  decorateNode?: (span: CategorizedSpan) => NodeDecoration | undefined;
  initialFocus?: { spanId: string; zoom: number; done: { current: boolean } };
}

const TraceFlowContext = createContext<TraceFlowContextValue>({
  onSelectSpan: () => {},
  spanMap: new Map(),
});

/**
 * Custom wrapper around AgentCardNode that selects the corresponding span on click. The click
 * still reaches CelestialMap, which centers the node (onNodeClickZoom="centerOnNode").
 */
/**
 * Centers the map on one node at a fixed zoom, once, after the map's own fit (rendered inside
 * that node, where the map's ReactFlow instance is in reach).
 */
const InitialFocus: React.FC<{ nodeId: string; zoom: number; done: { current: boolean } }> = ({
  nodeId,
  zoom,
  done,
}) => {
  const reactFlow = useReactFlow();
  useEffect(() => {
    if (done.current) return;
    const timer = setTimeout(() => {
      const node = reactFlow.getNode(nodeId);
      if (!node || done.current) return;
      done.current = true;
      const width = node.measured?.width ?? node.width ?? 272;
      const height = node.measured?.height ?? node.height ?? 156;
      reactFlow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom,
        duration: 0,
      });
    }, INITIAL_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reactFlow, nodeId, zoom, done]);
  return null;
};

const TraceAgentCardNode = (props: NodeProps<any>) => {
  const { onSelectSpan, spanMap, decorateNode, initialFocus } = useContext(TraceFlowContext);
  const focusHere =
    initialFocus && (props.data.id === initialFocus.spanId || props.id === initialFocus.spanId) ? (
      <InitialFocus
        nodeId={props.id ?? props.data.id}
        zoom={initialFocus.zoom}
        done={initialFocus.done}
      />
    ) : null;
  const nodeSpan = spanMap.get(props.data.id);
  const decoration = nodeSpan && decorateNode ? decorateNode(nodeSpan) : undefined;

  const selectSpan = useCallback(() => {
    const span = spanMap.get(props.data.id);
    if (span) {
      onSelectSpan(span);
    }
  }, [onSelectSpan, spanMap, props.data.id]);

  const handleClick = useCallback(() => selectSpan(), [selectSpan]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        selectSpan();
      }
    },
    [selectSpan]
  );

  if (!decoration) {
    return (
      <div onClick={handleClick} onKeyDown={handleKeyDown} role="presentation">
        {focusHere}
        <AgentCardNode {...props} />
      </div>
    );
  }
  return (
    <div
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="presentation"
      className={`agentTracesFlow__decorated ${decoration.className ?? ''}`}
      data-test-subj="agentTracesFlowDecoratedNode"
    >
      {focusHere}
      {decoration.badge && <div className="agentTracesFlow__nodeBadge">{decoration.badge}</div>}
      <AgentCardNode {...props} />
    </div>
  );
};

const NODE_TYPES = { agentCard: TraceAgentCardNode };

export const TraceFlowView: React.FC<TraceFlowViewProps> = ({
  spanTree,
  totalDuration: _totalDuration,
  selectedSpan: _selectedSpan,
  onSelectSpan,
  isLoading,
  loadError,
  decorateNode,
  showMinimap = true,
  initialFocusSpanId,
  initialZoom = 1,
}) => {
  // Once per focus target: re-renders and node remounts do not move the view again.
  const focusDone = useRef(false);
  useEffect(() => {
    focusDone.current = false;
  }, [initialFocusSpanId]);
  // Categorize spans and build CelestialMap data
  const categorizedTree = useMemo(() => categorizeSpanTree(spanTree), [spanTree]);

  const { mapData, spanMap } = useMemo(() => {
    if (categorizedTree.length === 0) {
      return {
        mapData: { root: { nodes: [] as any[], edges: [] as any[] } },
        spanMap: new Map<string, CategorizedSpan>(),
      };
    }

    const { nodes, edges } = spansToFlow(categorizedTree);
    const map = new Map<string, CategorizedSpan>();

    const collectSpans = (spans: CategorizedSpan[]) => {
      for (const span of spans) {
        map.set(span.spanId || span.id, span);
        if (span.children && span.children.length > 0) {
          collectSpans(span.children as CategorizedSpan[]);
        }
      }
    };
    collectSpans(categorizedTree);

    return { mapData: { root: { nodes, edges } }, spanMap: map };
  }, [categorizedTree]);

  const contextValue = useMemo<TraceFlowContextValue>(
    () => ({
      onSelectSpan,
      spanMap,
      decorateNode,
      initialFocus: initialFocusSpanId
        ? { spanId: initialFocusSpanId, zoom: initialZoom, done: focusDone }
        : undefined,
    }),
    [onSelectSpan, spanMap, decorateNode, initialFocusSpanId, initialZoom]
  );

  // Deselect when clicking the ReactFlow background pane
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.react-flow__pane')) {
        onSelectSpan(null);
      }
    },
    [onSelectSpan]
  );

  if (isLoading) {
    return (
      <div className="agentTracesFlyout__loadingPanel agentTracesFlow__loadingPanel">
        <EuiLoadingSpinner size="l" />
        <EuiSpacer size="s" />
        <EuiText size="s" color="subdued">
          <FormattedMessage
            id="agentTraces.flowView.loadingTraceGraph"
            defaultMessage="Loading trace graph..."
          />
        </EuiText>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="agentTracesFlow__emptyState">
        <EuiEmptyPrompt
          iconType="alert"
          iconColor="danger"
          title={
            <h3>
              <FormattedMessage
                id="agentTraces.flowView.errorLoadingTraceGraph"
                defaultMessage="Failed to load trace graph"
              />
            </h3>
          }
          body={<p>{loadError}</p>}
        />
      </div>
    );
  }

  if (spanTree.length === 0) {
    return (
      <div className="agentTracesFlow__emptyState">
        <EuiText color="subdued" size="s">
          <FormattedMessage
            id="agentTraces.flowView.noSpansToDisplay"
            defaultMessage="No spans to display"
          />
        </EuiText>
      </div>
    );
  }

  return (
    <TraceFlowContext.Provider value={contextValue}>
      <div
        className="agentTracesFlow__container"
        role="presentation"
        onClick={handleContainerClick}
      >
        <CelestialMap
          map={mapData}
          nodeTypes={NODE_TYPES}
          layoutOptions={{ direction: 'TB', rankSeparation: 80, nodeSeparation: 40 }}
          legend={false}
          breadcrumbs={[]}
          showMinimap={showMinimap}
          // Deep trace trees need to zoom out further than the default 60% floor to fit
          // the flyout panel, and the panel is resizable.
          fitViewOptions={{ minZoom: 0.1 }}
          refitOnResize
          // Clicking a node pans it to the center at the current zoom.
          onNodeClickZoom="centerOnNode"
          topN={Infinity}
        />
      </div>
    </TraceFlowContext.Provider>
  );
};
