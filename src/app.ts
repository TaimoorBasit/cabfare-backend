import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', cors());

// Basic health check route
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (c) => {
  return c.text('CabFare API Backend is running successfully on Hono/Cloudflare.');
});

// We will mount routes here
import apiRoutes from './routes/api';
app.route('/api', apiRoutes);

app.onError((err, c) => {
  console.error(err.stack);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
