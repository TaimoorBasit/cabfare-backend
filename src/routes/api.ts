import { Hono } from 'hono';
import { env } from 'hono/adapter';
import * as adminAvailability from '../controllers/admin_availabilityController';
import * as adminConfig from '../controllers/admin_configController';
import * as adminPricingMatrix from '../controllers/admin_pricing-matrixController';
import * as adminRouteTemplates from '../controllers/admin_route-templatesController';
import * as adminSeasonal from '../controllers/admin_seasonalController';
import * as authLogin from '../controllers/auth_loginController';
import * as authMe from '../controllers/auth_meController';
import * as authRegister from '../controllers/auth_registerController';
import * as bookings from '../controllers/bookingsController';
import * as dbTest from '../controllers/db-testController';
import * as hello from '../controllers/helloController';
import * as quotesCalculate from '../controllers/quotes_calculateController';
import { fleetEconomics } from '../engines/pricingEngine';

const api = new Hono();

// Shim
const createShim = (handler: any) => {
    return async (c: any) => {
        let body = {};
        if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
            body = await c.req.json().catch(() => ({}));
        }
        const req = {
            body,
            query: c.req.query(),
            headers: c.req.header(),
            env: env(c) // Attach Cloudflare environment variables seamlessly
        };
        let responseSent = false;
        let responsePayload: any = null;
        const res = {
            status: (code: number) => { c.status(code); return res; },
            json: (data: any) => { responseSent = true; responsePayload = c.json(data); return responsePayload; },
            send: (data: any) => { responseSent = true; responsePayload = c.text(data); return responsePayload; }
        };
        try {
            await handler(req, res);
            if (responseSent) return responsePayload;
            return c.text('');
        } catch (e: any) {
            console.error("Handler error:", e);
            return c.json({ error: e.message || 'Internal error', stack: e.stack }, 500);
        }
    };
};

const bindHandler = (controller: any, method: string) => {
    return createShim(controller[method] || (async (req: any, res: any) => res.status(501).json({ error: 'Not implemented' })));
};

// Admin Config
api.get('/admin/config', bindHandler(adminConfig, 'getHandler'));
api.post('/admin/config', bindHandler(adminConfig, 'postHandler'));

// Fleet Economics calculation endpoint
api.post('/admin/economics', createShim(async (req: any, res: any) => {
    const dbData = req.body;
    try {
        const eco = fleetEconomics(dbData);
        res.json(eco);
    } catch (e) {
        res.status(500).json({ error: 'Calculation failed' });
    }
}));

// Admin Pricing Matrix
api.get('/admin/pricing-matrix', bindHandler(adminPricingMatrix, 'getHandler'));
api.post('/admin/pricing-matrix', bindHandler(adminPricingMatrix, 'postHandler'));
api.put('/admin/pricing-matrix', bindHandler(adminPricingMatrix, 'putHandler'));
api.delete('/admin/pricing-matrix', bindHandler(adminPricingMatrix, 'deleteHandler'));

// Admin Route Templates
api.get('/admin/route-templates', bindHandler(adminRouteTemplates, 'getHandler'));
api.post('/admin/route-templates', bindHandler(adminRouteTemplates, 'postHandler'));
api.put('/admin/route-templates', bindHandler(adminRouteTemplates, 'putHandler'));
api.delete('/admin/route-templates', bindHandler(adminRouteTemplates, 'deleteHandler'));

// Admin Seasonal
api.get('/admin/seasonal', bindHandler(adminSeasonal, 'getHandler'));
api.post('/admin/seasonal', bindHandler(adminSeasonal, 'postHandler'));
api.put('/admin/seasonal', bindHandler(adminSeasonal, 'putHandler'));
api.delete('/admin/seasonal', bindHandler(adminSeasonal, 'deleteHandler'));

// Admin Availability
api.get('/admin/availability', bindHandler(adminAvailability, 'getHandler'));
api.post('/admin/availability', bindHandler(adminAvailability, 'postHandler'));
api.delete('/admin/availability', bindHandler(adminAvailability, 'deleteHandler'));

// Bookings
api.get('/bookings', bindHandler(bookings, 'getHandler'));
api.post('/bookings', bindHandler(bookings, 'postHandler'));
api.delete('/bookings', bindHandler(bookings, 'deleteHandler'));
api.put('/bookings', bindHandler(bookings, 'putHandler'));

// Quotes
api.post('/quotes/calculate', bindHandler(quotesCalculate, 'postHandler'));

// Hello
api.get('/hello', bindHandler(hello, 'getHandler'));

export default api;
