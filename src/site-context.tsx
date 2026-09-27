import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import seed from './site-seed.json';
import type { Group } from './data';
export type SiteData = Omit<typeof seed, 'groups'> & { groups: Group[]; media?: Record<string, string>; videos?: Record<string, string>; events?: { id: string; title: string; text: string; date: string; active: boolean }[]; delivery?: { emailConfigured: boolean; mode: string } };
const SiteContext = createContext<SiteData>(seed as SiteData);
export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteData>(seed as SiteData);
  useEffect(() => { let alive = true; const refresh = () => fetch('/api/site').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { if (alive) setSite(data); }).catch(() => {}); void refresh(); window.addEventListener('focus', refresh); return () => { alive = false; window.removeEventListener('focus', refresh); }; }, []);
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useSite() { return useContext(SiteContext); }
