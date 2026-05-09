import serverless from 'serverless-http';
import app, { serverReady } from '../../server/index.js';

const expressHandler = serverless(app);

export const handler = async (event: unknown, context: unknown) => {
  await serverReady;
  return expressHandler(event, context);
};
