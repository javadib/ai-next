"use client";

import { useId } from "react";

/**
 * Brand mark — two routes merging into a forward arrow on the brand gradient
 * (green → turquoise → light violet). Same artwork as public/favicon.svg and the app icons.
 * Operators can still upload a custom logo from Settings → Appearance.
 */
type BrandLogoProps = {
  size?: number;
  className?: string;
};

export const BRAND_GRADIENT_STOPS = ["#22C55E", "#2DD4BF", "#A78BFA"] as const;

export default function BrandLogo({ size = 20, className = "" }: BrandLogoProps) {
  const gradientId = `brand-gradient-${useId().replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="2"
          y1="2"
          x2="30"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={BRAND_GRADIENT_STOPS[0]} />
          <stop offset="0.5" stopColor={BRAND_GRADIENT_STOPS[1]} />
          <stop offset="1" stopColor={BRAND_GRADIENT_STOPS[2]} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <g transform="translate(0.8 0)">
        <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M9.6 10.6C13.6 11.4 13.8 16 17.4 16" />
          <path d="M9.6 21.4C13.6 20.6 13.8 16 17.4 16" />
          <path d="M17.4 16H24.4" />
          <path d="M20.6 11.9L24.7 16L20.6 20.1" />
        </g>
        <circle cx="8" cy="10.2" r="2.3" fill="#fff" />
        <circle cx="8" cy="21.8" r="2.3" fill="#fff" />
      </g>
    </svg>
  );
}
