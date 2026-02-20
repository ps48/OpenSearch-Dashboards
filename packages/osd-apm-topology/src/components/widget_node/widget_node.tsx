/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import { getIcon } from '../../shared/utils/icons.utils';
import { DEFAULT_METRICS } from '../../shared/constants/common.constants';
import { HealthDonut } from '../health_donut';

const ICON_SIZE = 60;

export type WidgetNodeProps = {
    id: string;
    title: string;
    subtitle?: string;
    type: string; // This will determine the icon and also be the subtitle if not provided
    status: string; // one of ok|fault|error
    isSource?: boolean;
    isTarget?: boolean;
};

export type WidgetNodeType = Node<WidgetNodeProps, 'widget'>;
export const WidgetNode = (props: NodeProps<WidgetNodeType>) => {
    const {
        data: { title, subtitle, type, status, isSource, isTarget },
    } = props;
    return (
        <div className="flex flex-col items-center">
            <div>
                <HealthDonut metrics={{ ...DEFAULT_METRICS }} size={ICON_SIZE} icon={getIcon(type)} status={status}>
                    {isSource && (
                        <Handle type="source" position={Position.Right} id="source-right" style={{ opacity: 0 }} />
                    )}
                    {isTarget && (
                        <Handle type="target" position={Position.Left} id="target-left" style={{ opacity: 0 }} />
                    )}
                </HealthDonut>
            </div>
            <div className="mt-1 text-center">
                <div className="font-medium text-xs text-body-default">{title}</div>
                {subtitle && <div className="text-xs text-gray-500">{subtitle || type}</div>}
            </div>
        </div>
    );
};

export default WidgetNode;
