/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Agent monitoring "Evaluations" nav icon: a checklist with the same AI sparkle badge as the
 * Traces and Spans icons. Drawn in `currentColor`; the halo uses the core `agentBadgeHalo`
 * class, so like the other agent icons it is meant for the side nav.
 */
export const AgentEvalsIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    {...props}
  >
    <path d="M1.85 5.65a.5.5 0 0 1 .7-.7L3.5 5.9l1.95-1.95a.5.5 0 1 1 .7.7L3.85 6.96a.5.5 0 0 1-.7 0l-1.3-1.3ZM7.5 5.5a.5.5 0 0 1 0-1h1a.5.5 0 0 1 0 1h-1Zm-5.65 4.15a.5.5 0 0 1 .7-.7l.95.95 1.95-1.95a.5.5 0 1 1 .7.7l-2.3 2.31a.5.5 0 0 1-.7 0l-1.3-1.3ZM7.5 9.5a.5.5 0 0 1 0-1h6a.5.5 0 0 1 0 1h-6Zm-5 4a.5.5 0 0 1 0-1h11a.5.5 0 0 1 0 1h-11Z" />
    <circle cx="12.6" cy="3.4" r="4" className="agentBadgeHalo" />
    <g transform="translate(12.6 3.4)">
      <path d="M0,-3.4 C0,-1.6 -1.6,0 -3.4,0 C-1.6,0 0,1.6 0,3.4 C0,1.6 1.6,0 3.4,0 C1.6,0 0,-1.6 0,-3.4Z" />
    </g>
  </svg>
);
