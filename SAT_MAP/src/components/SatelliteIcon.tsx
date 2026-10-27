import React from 'react';

interface SatelliteIconProps {
  className?: string;
  accent?: string;
  hasBlink?: boolean;
  blinkColor?: 'red' | 'cyan' | 'amber';
  rotation?: number;
}

export function SatelliteIcon({
  className = 'w-5 h-5',
  accent = '#00e5ff',
  hasBlink = true,
  blinkColor = 'red',
  rotation = 0,
}: SatelliteIconProps) {
  const beaconColor =
    blinkColor === 'red'
      ? '#ff3344'
      : blinkColor === 'amber'
      ? '#ffaa00'
      : '#00e5ff';

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
        style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 180ms linear' }}
      >
        {/* Antenna Mast (pointing to upper-left tip) */}
        <line
          x1="16"
          y1="16"
          x2="6"
          y2="6"
          stroke={accent}
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* Antenna Dish / cross-beam */}
        <line
          x1="8"
          y1="10"
          x2="10"
          y2="8"
          stroke={accent}
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* Solar Panel - Left Wing (rotated 45 deg) */}
        <g transform="translate(16,16) rotate(45) translate(-16,-16)">
          <rect
            x="2"
            y="13"
            width="8"
            height="6"
            rx="1"
            fill="currentColor"
            fillOpacity="0.25"
            stroke={accent}
            strokeWidth="1.2"
          />
          {/* Panel Solar Cell Ribs */}
          <line x1="6" y1="13" x2="6" y2="19" stroke={accent} strokeWidth="0.8" opacity="0.6" />
          <line x1="2" y1="16" x2="10" y2="16" stroke={accent} strokeWidth="0.8" opacity="0.6" />

          {/* Solar Panel - Right Wing */}
          <rect
            x="22"
            y="13"
            width="8"
            height="6"
            rx="1"
            fill="currentColor"
            fillOpacity="0.25"
            stroke={accent}
            strokeWidth="1.2"
          />
          {/* Panel Solar Cell Ribs */}
          <line x1="26" y1="13" x2="26" y2="19" stroke={accent} strokeWidth="0.8" opacity="0.6" />
          <line x1="22" y1="16" x2="30" y2="16" stroke={accent} strokeWidth="0.8" opacity="0.6" />

          {/* Central Connecting Struts */}
          <line x1="10" y1="16" x2="13" y2="16" stroke={accent} strokeWidth="1.2" />
          <line x1="19" y1="16" x2="22" y2="16" stroke={accent} strokeWidth="1.2" />
        </g>

        {/* Central Satellite Chassis / Core */}
        <rect
          x="12.5"
          y="12.5"
          width="7"
          height="7"
          rx="1.8"
          fill="#0c1929"
          stroke={accent}
          strokeWidth="1.6"
        />
        <circle cx="16" cy="16" r="1.5" fill={accent} />

        {/* Antenna Tip Beacon Light Base */}
        <circle cx="6" cy="6" r="1.8" fill={beaconColor} />
      </svg>

      {/* Blinking Light at Top Tip */}
      {hasBlink && (
        <span
          className="absolute"
          style={{
            left: '18.75%', // maps to cx=6 in 32px box (6/32 = 18.75%)
            top: '18.75%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Pulsing beacon ping */}
          <span
            className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full opacity-75"
            style={{ backgroundColor: beaconColor }}
          />
          {/* Steady central bright LED */}
          <span
            className="relative inline-flex rounded-full h-1.5 w-1.5 shadow-[0_0_8px_#ff3344]"
            style={{ backgroundColor: beaconColor }}
          />
        </span>
      )}
    </div>
  );
}

export default SatelliteIcon;
