import {useEffect, useState} from 'react';

export interface Route {
  view: string;
  id?: string;
  tab: string;
}

export function parseRoute(hash: string): Route {
  const parts = (hash || '#clients').slice(1).split('/');
  return {view: parts[0], id: parts[1], tab: parts[2] || 'overview'};
}

export function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export const navigate = (hash: string) => { location.hash = hash; };
