/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Animated SVG: prompt bubble → sparkle arrow → dashboard preview
 * All three visible simultaneously, animation loops.
 */
export const CanvasEmptyAnimation: React.FC = () => {
  return (
    <svg
      width="400"
      height="140"
      viewBox="0 0 400 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', margin: '0 auto' }}
    >
      <style>{`
        @keyframes typeLine { from { width: 0; } to { width: 100%; } }
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes sparkle { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
        @keyframes flowDash { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
        @keyframes barGrow { 0%,10% { transform: scaleY(0); } 40%,100% { transform: scaleY(1); } }
        @keyframes rowSlide { 0%,15% { opacity: 0; transform: translateX(-5px); } 45%,100% { opacity: 1; transform: translateX(0); } }
        @keyframes cardPop { 0%,5% { opacity: 0; transform: scale(0.8); } 35%,100% { opacity: 1; transform: scale(1); } }
        @keyframes lineChart { 0%,20% { stroke-dashoffset: 60; } 60%,100% { stroke-dashoffset: 0; } }
        .cursor { animation: blink 0.8s step-end infinite; }
        .spark1 { animation: sparkle 1.5s ease-in-out infinite; }
        .spark2 { animation: sparkle 1.5s ease-in-out 0.3s infinite; }
        .spark3 { animation: sparkle 1.5s ease-in-out 0.6s infinite; }
        .spark4 { animation: sparkle 1.5s ease-in-out 0.9s infinite; }
        .flow { stroke-dasharray: 6 4; animation: flowDash 1s linear infinite; }
        .b1 { animation: barGrow 4s ease-out infinite; transform-origin: bottom center; }
        .b2 { animation: barGrow 4s ease-out 0.2s infinite; transform-origin: bottom center; }
        .b3 { animation: barGrow 4s ease-out 0.4s infinite; transform-origin: bottom center; }
        .b4 { animation: barGrow 4s ease-out 0.6s infinite; transform-origin: bottom center; }
        .b5 { animation: barGrow 4s ease-out 0.8s infinite; transform-origin: bottom center; }
        .r1 { animation: rowSlide 4s ease-out infinite; }
        .r2 { animation: rowSlide 4s ease-out 0.15s infinite; }
        .r3 { animation: rowSlide 4s ease-out 0.3s infinite; }
        .c1 { animation: cardPop 4s ease-out infinite; }
        .c2 { animation: cardPop 4s ease-out 0.15s infinite; }
        .c3 { animation: cardPop 4s ease-out 0.3s infinite; }
        .lc { stroke-dasharray: 60; animation: lineChart 4s ease-out infinite; }
      `}</style>

      {/* === LEFT: Prompt bubble === */}
      <g transform="translate(10, 20)">
        <rect
          x="0"
          y="0"
          width="100"
          height="80"
          rx="10"
          fill="#006BB4"
          opacity="0.07"
          stroke="#006BB4"
          strokeWidth="1.2"
        />
        {/* Text lines */}
        <rect x="12" y="14" width="55" height="4" rx="2" fill="#006BB4" opacity="0.5" />
        <rect x="12" y="24" width="70" height="4" rx="2" fill="#006BB4" opacity="0.4" />
        <rect x="12" y="34" width="45" height="4" rx="2" fill="#006BB4" opacity="0.35" />
        <rect x="12" y="44" width="60" height="4" rx="2" fill="#006BB4" opacity="0.3" />
        <rect x="12" y="54" width="35" height="4" rx="2" fill="#006BB4" opacity="0.25" />
        {/* Blinking cursor */}
        <rect x="49" y="53" width="2" height="6" rx="1" fill="#006BB4" className="cursor" />
        {/* Chat bubble tail */}
        <polygon
          points="75,80 85,95 65,80"
          fill="#006BB4"
          opacity="0.07"
          stroke="#006BB4"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </g>

      {/* === CENTER: Arrow with sparkles === */}
      <g transform="translate(120, 45)">
        {/* Dashed flow line */}
        <line x1="0" y1="15" x2="50" y2="15" stroke="#006BB4" strokeWidth="1.5" className="flow" />
        {/* Arrow head */}
        <polygon points="48,10 58,15 48,20" fill="#006BB4" opacity="0.8" />
        {/* Sparkles */}
        <circle cx="15" cy="3" r="3" fill="#F5A700" className="spark1" />
        <circle cx="35" cy="-2" r="2.5" fill="#006BB4" className="spark2" />
        <circle cx="25" cy="30" r="2" fill="#017D73" className="spark3" />
        <circle cx="45" cy="5" r="2" fill="#F5A700" className="spark4" />
        {/* Star */}
        <path
          d="M28,8 L29.5,4 L31,8 L35,8 L32,10.5 L33,14.5 L29.5,12 L26,14.5 L27,10.5 L24,8 Z"
          fill="#F5A700"
          opacity="0.6"
          className="spark2"
        />
      </g>

      {/* === RIGHT: Dashboard preview === */}
      <g transform="translate(190, 5)">
        {/* Window frame */}
        <rect
          x="0"
          y="0"
          width="195"
          height="130"
          rx="8"
          fill="white"
          stroke="#D3DAE6"
          strokeWidth="1.5"
        />
        {/* Title bar */}
        <rect x="0" y="0" width="195" height="22" rx="8" fill="#F5F7FA" />
        <rect x="0" y="14" width="195" height="8" fill="#F5F7FA" />
        <circle cx="14" cy="11" r="3.5" fill="#BD271E" opacity="0.5" />
        <circle cx="26" cy="11" r="3.5" fill="#F5A700" opacity="0.5" />
        <circle cx="38" cy="11" r="3.5" fill="#017D73" opacity="0.5" />

        {/* Stat cards row */}
        <g className="c1">
          <rect
            x="8"
            y="28"
            width="55"
            height="24"
            rx="4"
            fill="#006BB4"
            opacity="0.06"
            stroke="#006BB4"
            strokeWidth="0.7"
            strokeOpacity="0.3"
          />
          <rect x="14" y="33" width="25" height="5" rx="2" fill="#006BB4" opacity="0.6" />
          <rect x="14" y="42" width="35" height="3" rx="1.5" fill="#006BB4" opacity="0.25" />
        </g>
        <g className="c2">
          <rect
            x="70"
            y="28"
            width="55"
            height="24"
            rx="4"
            fill="#017D73"
            opacity="0.06"
            stroke="#017D73"
            strokeWidth="0.7"
            strokeOpacity="0.3"
          />
          <rect x="76" y="33" width="30" height="5" rx="2" fill="#017D73" opacity="0.6" />
          <rect x="76" y="42" width="28" height="3" rx="1.5" fill="#017D73" opacity="0.25" />
        </g>
        <g className="c3">
          <rect
            x="132"
            y="28"
            width="55"
            height="24"
            rx="4"
            fill="#BD271E"
            opacity="0.06"
            stroke="#BD271E"
            strokeWidth="0.7"
            strokeOpacity="0.3"
          />
          <rect x="138" y="33" width="20" height="5" rx="2" fill="#BD271E" opacity="0.6" />
          <rect x="138" y="42" width="32" height="3" rx="1.5" fill="#BD271E" opacity="0.25" />
        </g>

        {/* Bar chart (left) */}
        <rect
          x="8"
          y="58"
          width="85"
          height="60"
          rx="3"
          fill="#F5F7FA"
          stroke="#D3DAE6"
          strokeWidth="0.5"
        />
        <rect
          x="16"
          y="96"
          width="10"
          height="18"
          rx="1.5"
          fill="#006BB4"
          opacity="0.6"
          className="b1"
        />
        <rect
          x="30"
          y="86"
          width="10"
          height="28"
          rx="1.5"
          fill="#006BB4"
          opacity="0.75"
          className="b2"
        />
        <rect
          x="44"
          y="92"
          width="10"
          height="22"
          rx="1.5"
          fill="#017D73"
          opacity="0.65"
          className="b3"
        />
        <rect
          x="58"
          y="80"
          width="10"
          height="34"
          rx="1.5"
          fill="#006BB4"
          opacity="0.85"
          className="b4"
        />
        <rect
          x="72"
          y="88"
          width="10"
          height="26"
          rx="1.5"
          fill="#017D73"
          opacity="0.7"
          className="b5"
        />

        {/* Table (right) */}
        <rect x="100" y="58" width="87" height="8" rx="1.5" fill="#D3DAE6" opacity="0.4" />
        <rect x="100" y="70" width="87" height="7" rx="1.5" fill="#F5F7FA" className="r1" />
        <rect
          x="104"
          y="71.5"
          width="30"
          height="4"
          rx="1"
          fill="#006BB4"
          opacity="0.25"
          className="r1"
        />
        <rect x="100" y="81" width="87" height="7" rx="1.5" fill="#F5F7FA" className="r2" />
        <rect
          x="104"
          y="82.5"
          width="40"
          height="4"
          rx="1"
          fill="#017D73"
          opacity="0.25"
          className="r2"
        />
        <rect x="100" y="92" width="87" height="7" rx="1.5" fill="#F5F7FA" className="r3" />
        <rect
          x="104"
          y="93.5"
          width="22"
          height="4"
          rx="1"
          fill="#F5A700"
          opacity="0.3"
          className="r3"
        />

        {/* Line chart at bottom */}
        <path
          d="M104 110 Q120 102, 130 106 Q140 110, 155 100 Q165 94, 180 98"
          stroke="#017D73"
          strokeWidth="1.5"
          fill="none"
          opacity="0.5"
          className="lc"
        />
      </g>
    </svg>
  );
};
