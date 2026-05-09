import serverless from 'serverless-http';
import app, { serverReady } from '../../server/index.js';

const expressHandler = serverless(app);

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
