import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { compress } from 'hono/compress';

const app = new Hono();

app.use('*', compress());
app.use('*', cors({
  origin: (origin, c) => {
    const configuredOrigins = String(c.env?.ADMIN_ORIGINS || 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((value: string) => value.trim())
      .filter(Boolean);
    return configuredOrigins.includes(origin) ? origin : '';
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400
}));


app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});


app.get('/', (c) => {
  return c.text('CabFare API Backend is running successfully on Hono/Cloudflare.');
});


import apiRoutes from './routes/api';
app.route('/api', apiRoutes);

app.onError((err, c) => {
  console.error(err.stack);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
