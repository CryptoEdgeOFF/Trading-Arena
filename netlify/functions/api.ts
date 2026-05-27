import serverless from 'serverless-http';
import app, { serverReady } from '../../server/index.js';

/**
 * Sans cette option, serverless-http sérialise le body Express en
 * latin-1, ce qui corrompt les bytes des images servies par
 * /api/avatars/:id. Avec la liste binary ci-dessous, le response body
 * est encodé en base64 et `isBase64Encoded: true` est renvoyé à Netlify
 * qui re-décode côté CDN avant d'envoyer au client.
 */
const expressHandler = serverless(app, {
  binary: [
    'image/*',
    'application/octet-stream',
    'application/pdf',
  ],
});

function normalizeNetlifyPath(event: unknown): unknown {
  if (!event || typeof event !== 'object') return event;
  const next = { ...(event as Record<string, unknown>) };
  const path = typeof next.path === 'string' ? next.path : '';

  if (path.startsWith('/.netlify/functions/api/uploads/')) {
    next.path = path.replace('/.netlify/functions/api/uploads/', '/uploads/');
  } else if (path.startsWith('/.netlify/functions/api/api/')) {
    next.path = path.replace('/.netlify/functions/api/api/', '/api/');
  } else if (path.startsWith('/.netlify/functions/api/')) {
    next.path = path.replace('/.netlify/functions/api/', '/api/');
  } else if (path.startsWith('/api/api/')) {
    next.path = path.replace('/api/api/', '/api/');
  }

  if (typeof next.rawUrl === 'string') {
    next.rawUrl = next.rawUrl
      .replace('/.netlify/functions/api/uploads/', '/uploads/')
      .replace('/.netlify/functions/api/api/', '/api/')
      .replace('/.netlify/functions/api/', '/api/')
      .replace('/api/api/', '/api/');
  }

  return next;
}

export const handler = async (event: unknown, context: unknown) => {
  await serverReady;
  return expressHandler(normalizeNetlifyPath(event), context);
};
