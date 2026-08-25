import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export const MOBILE_WEB_MQ = '(max-width: 767px)';

const MobileWebContext = createContext(false);

export function useMobileMediaQuery(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_WEB_MQ).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(MOBILE_WEB_MQ);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return isMobile;
}

export function MobileWebProvider({ children }: { children: ReactNode }) {
  const isMobile = useMobileMediaQuery();
  return <MobileWebContext.Provider value={isMobile}>{children}</MobileWebContext.Provider>;
}

export function useIsMobileWeb(): boolean {
  return useContext(MobileWebContext);
}
