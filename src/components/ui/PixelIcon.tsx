import type { SVGProps } from "react";

const paths = {
  office: "M3 3h10v10H3z M6 13V9h4v4 M6 6h1 M9 6h1",
  projects: "M2 4h5l2 2h5v7H2z M2 4V2h5l2 2",
  settings: "M6 1h4v3h3v2h2v4h-3v3h-2v2H6v-3H3v-2H1V6h3V3h2z M6 6h4v4H6z",
  bell: "M6 2h4v2h2v6h2v2H2v-2h2V4h2z M6 14h4",
  close: "M3 3l10 10 M13 3L3 13",
  check: "M2 8l4 4L14 4",
  arrow: "M2 8h11 M9 3l5 5-5 5",
  grid: "M2 2h4v4H2z M10 2h4v4h-4z M2 10h4v4H2z M10 10h4v4h-4z",
  chat: "M2 2h12v9H7l-4 3v-3H2z M5 5h6 M5 8h4",
  minus: "M3 8h10",
  plus: "M3 8h10 M8 3v10",
  alert: "M7 2h2v7H7z M7 12h2v2H7z",
} as const;
export type PixelIconName = keyof typeof paths;
export function PixelIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: PixelIconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
