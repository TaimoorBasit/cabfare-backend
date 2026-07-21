import { serve } from '@hono/node-server';
import app from './app';

const PORT = Number(process.env.PORT) || 5000;

serve({
  fetch: app.fetch,
  port: PORT
}, (info) => {
  console.log(`Backend server is running on port ${info.port}`);
});
