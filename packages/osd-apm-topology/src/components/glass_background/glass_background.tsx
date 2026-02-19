/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


import { PropsWithChildren } from 'react';

export const GlassBackground: React.FC<PropsWithChildren> = ({ children }: PropsWithChildren) => {
    return (
        <div className="bg-container-default/0.2 backdrop-blur-xs absolute inset-0 flex justify-center items-center z-10">
            {children}
        </div>
    );
};
