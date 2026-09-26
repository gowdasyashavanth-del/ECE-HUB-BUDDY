// Minimal inline SVG icons, matching the stroke-based style already
// established by Logo.tsx (currentColor, rounded strokes). No icon
// library exists in this project's dependencies — these are hand-drawn
// to avoid adding one just for three icons.
import type { SVGProps } from "react";

function iconProps(props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

export function GraduationCapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path d="M2 8.5 12 4l10 4.5-10 4.5L2 8.5Z" />
      <path d="M6 10.8v4.4c0 1 2.7 2.3 6 2.3s6-1.3 6-2.3v-4.4" />
      <path d="M20.5 9.5v5.5" />
    </svg>
  );
}

export function PresentationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20l4-4 4 4" />
      <path d="M8 8.5h5M8 11.5h8" />
    </svg>
  );
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 3l7 3v5.2c0 4.4-2.9 7.9-7 9.3-4.1-1.4-7-4.9-7-9.3V6l7-3Z" />
      <path d="M9.2 12.1l1.9 1.9 3.7-3.7" />
    </svg>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps({ width: 18, height: 18, ...props })}>
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps({ width: 18, height: 18, ...props })}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c7 0 10.5 7 10.5 7a17.6 17.6 0 0 1-3.2 4.2M6.5 6.6C3.4 8.5 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.7-.3 3.8-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
