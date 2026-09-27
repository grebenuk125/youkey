// Adapted from Magic UI Marquee (MIT). CSS tokens replace Tailwind utilities.
import type { ReactNode } from 'react';
export function Marquee({ children, paused = false }: { children: ReactNode; paused?: boolean }) {
  return <div className={`marquee ${paused ? 'is-paused' : ''}`} aria-hidden="true">{[0, 1, 2, 3].map(i => <div className="marquee-track" key={i}>{children}</div>)}</div>;
}
