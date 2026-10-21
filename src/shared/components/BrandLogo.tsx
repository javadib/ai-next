import { brandInitials } from "@/shared/constants/brand";

/**
 * Placeholder brand mark — the brand initials. Replace with the final logo SVG when available;
 * operators can also upload a custom logo from Settings → Appearance.
 */
type BrandLogoProps = {
  size?: number;
  className?: string;
};

export default function BrandLogo({ size = 20, className = "" }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-hidden="true"
      suppressHydrationWarning
    >
      <text
        x="16"
        y="21.5"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="15"
        fontWeight="700"
        letterSpacing="-0.5"
        fill="currentColor"
      >
        {brandInitials()}
      </text>
    </svg>
  );
}
