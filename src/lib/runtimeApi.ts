const rawApiBase = (import.meta.env.VITE_API_URL || '').trim();
export const API_BASE_URL = rawApiBase.replace(/\/+$/, '');

function shouldProxyPath(path: string): boolean {
  return path.startsWith('/api/') || path === '/api' || path.startsWith('/uploads/');
}

function toApiUrl(path: string): string {
  if (!API_BASE_URL || !shouldProxyPath(path)) return path;
  return `${API_BASE_URL}${path}`;
}

const nativeFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (typeof input === 'string') {
    return nativeFetch(toApiUrl(input), init);
  }

  if (input instanceof URL) {
    return nativeFetch(new URL(toApiUrl(input.pathname + input.search + input.hash), input.origin), init);
  }

  if (input instanceof Request) {
    const url = new URL(input.url);
    if (url.origin === window.location.origin && shouldProxyPath(url.pathname)) {
      return nativeFetch(new Request(toApiUrl(url.pathname + url.search + url.hash), input), init);
    }
  }

  return nativeFetch(input, init);
};

export function getWebSocketUrl(path = '/ws'): string {
  if (API_BASE_URL) {
    const api = new URL(API_BASE_URL);
    api.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
    api.pathname = path;
    api.search = '';
    api.hash = '';
    return api.toString();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}${path}`;
}
