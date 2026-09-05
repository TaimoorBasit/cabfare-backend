import { Hono } from 'hono';
import { env } from 'hono/adapter';
import * as adminAvailability from '../controllers/admin_availabilityController';
import * as adminConfig from '../controllers/admin_configController';
import * as adminDashboard from '../controllers/admin_dashboardController';
import * as adminPricingMatrix from '../controllers/admin_pricing-matrixController';
import * as adminRouteTemplates from '../controllers/admin_route-templatesController';
import * as adminSeasonal from '../controllers/admin_seasonalController';
import * as authLogin from '../controllers/auth_loginController';
import * as authMe from '../controllers/auth_meController';
import * as authRegister from '../controllers/auth_registerController';
import * as authAccess from '../controllers/auth_accessController';
import * as adminStaff from '../controllers/admin_staffController';
import * as bookings from '../controllers/bookingsController';
import * as hello from '../controllers/helloController';
import * as quotesCalculate from '../controllers/quotes_calculateController';
import { fleetEconomics } from '../engines/pricingEngine';
import { getCurrentUser } from '../auth/auth';
import { can } from '../services/access';
import { recordSessionHeartbeat, touchUserActivity } from '../services/user';

const api = new Hono();

export const resolveAdminAuthorization = (authorization?: string, customToken?: string) =>
    authorization || (customToken ? `Bearer ${customToken}` : undefined);

const requireAdmin = async (c: any, next: any) => {
    const user = await getCurrentUser(resolveAdminAuthorization(c.req.header('Authorization'), c.req.header('X-Admin-Token')), env(c));
    if (!user) return c.json({ error: 'Authentication required' }, 401);
    c.set('adminUser', user);
    c.executionCtx?.waitUntil
      ? c.executionCtx.waitUntil(touchUserActivity(user.id, env(c)).catch(() => {}))
      : touchUserActivity(user.id, env(c)).catch(() => {});
    await next();
};

const requirePermission = (permission: string) => async (c: any, next: any) => {
    const user = c.get('adminUser');
    if (!user || !can(user, permission)) return c.json({ error: 'You do not have permission to use this area' }, 403);
    await next();
};
const requireAnyPermission = (...permissions: string[]) => async (c: any, next: any) => {
    const user = c.get('adminUser');
    if (!user || !permissions.some(permission => can(user, permission))) return c.json({ error: 'You do not have permission to use this area' }, 403);
    await next();
};

api.use('/admin/*', requireAdmin);
api.use('/bookings', async (c: any, next: any) => {
    if (c.req.method === 'POST') return next();
    return requireAdmin(c, next);
});


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
            env: env(c),
            adminUser: c.get('adminUser'),
            waitUntil: (p: Promise<any>) => { c.executionCtx?.waitUntil ? c.executionCtx.waitUntil(p) : p.catch(() => {}); }
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
            return c.json({ error: e.message || 'Internal error' }, 500);
        }
    };
};

const bindHandler = (controller: any, method: string) => {
    return createShim(controller[method] || (async (req: any, res: any) => res.status(501).json({ error: 'Not implemented' })));
};

api.post('/auth/login', bindHandler(authLogin, 'postHandler'));
api.post('/auth/register', bindHandler(authRegister, 'postHandler'));
api.get('/auth/me', bindHandler(authMe, 'getHandler'));
api.post('/auth/complete-invite', bindHandler(authAccess, 'inviteHandler'));
api.post('/auth/reset-password', bindHandler(authAccess, 'resetHandler'));
api.post('/auth/activity', async c => {
    const user = await getCurrentUser(c.req.header('Authorization'), env(c));
    if (!user) return c.json({ error: 'Authentication required' }, 401);
    await recordSessionHeartbeat(user.id, env(c));
    return c.json({ success: true });
});
api.post('/auth/logout', async c => {
    const user = await getCurrentUser(c.req.header('Authorization'), env(c));
    if (user) await recordSessionHeartbeat(user.id, env(c), true);
    return c.json({ success: true });
});


api.get('/admin/config', bindHandler(adminConfig, 'getHandler'));
api.post('/admin/config', requireAnyPermission('settings', 'pricing'), bindHandler(adminConfig, 'postHandler'));
api.get('/admin/dashboard', requirePermission('dashboard'), bindHandler(adminDashboard, 'getHandler'));
api.get('/admin/staff', requirePermission('staff'), bindHandler(adminStaff, 'getHandler'));
api.post('/admin/staff/invite', requirePermission('staff'), bindHandler(adminStaff, 'inviteHandler'));
api.post('/admin/staff/resend', requirePermission('staff'), bindHandler(adminStaff, 'resendHandler'));
api.post('/admin/staff/reset', requirePermission('staff'), bindHandler(adminStaff, 'resetHandler'));
api.put('/admin/staff', requirePermission('staff'), bindHandler(adminStaff, 'putHandler'));
api.delete('/admin/staff', requirePermission('staff'), bindHandler(adminStaff, 'deleteHandler'));


api.post('/admin/economics', requirePermission('fleet'), createShim(async (req: any, res: any) => {
    const dbData = req.body;
    try {
        const eco = fleetEconomics(dbData);
        res.json(eco);
    } catch (e) {
        res.status(500).json({ error: 'Calculation failed' });
    }
}));


api.get('/admin/pricing-matrix', requirePermission('pricing'), bindHandler(adminPricingMatrix, 'getHandler'));
api.post('/admin/pricing-matrix', requirePermission('pricing'), bindHandler(adminPricingMatrix, 'postHandler'));
api.put('/admin/pricing-matrix', requirePermission('pricing'), bindHandler(adminPricingMatrix, 'putHandler'));
api.delete('/admin/pricing-matrix', requirePermission('pricing'), bindHandler(adminPricingMatrix, 'deleteHandler'));


api.get('/admin/route-templates', requirePermission('pricing'), bindHandler(adminRouteTemplates, 'getHandler'));
api.post('/admin/route-templates', requirePermission('pricing'), bindHandler(adminRouteTemplates, 'postHandler'));
api.put('/admin/route-templates', requirePermission('pricing'), bindHandler(adminRouteTemplates, 'putHandler'));
api.delete('/admin/route-templates', requirePermission('pricing'), bindHandler(adminRouteTemplates, 'deleteHandler'));


api.get('/admin/seasonal', requirePermission('pricing'), bindHandler(adminSeasonal, 'getHandler'));
api.post('/admin/seasonal', requirePermission('pricing'), bindHandler(adminSeasonal, 'postHandler'));
api.put('/admin/seasonal', requirePermission('pricing'), bindHandler(adminSeasonal, 'putHandler'));
api.delete('/admin/seasonal', requirePermission('pricing'), bindHandler(adminSeasonal, 'deleteHandler'));


api.get('/admin/availability', requirePermission('fleet'), bindHandler(adminAvailability, 'getHandler'));
api.post('/admin/availability', requirePermission('fleet'), bindHandler(adminAvailability, 'postHandler'));
api.delete('/admin/availability', requirePermission('fleet'), bindHandler(adminAvailability, 'deleteHandler'));


api.get('/bookings', requirePermission('bookings'), bindHandler(bookings, 'getHandler'));
api.post('/bookings', bindHandler(bookings, 'postHandler'));
api.delete('/bookings', requirePermission('bookings'), bindHandler(bookings, 'deleteHandler'));
api.put('/bookings', requirePermission('bookings'), bindHandler(bookings, 'putHandler'));


api.post('/quotes/calculate', bindHandler(quotesCalculate, 'postHandler'));


api.get('/hello', bindHandler(hello, 'getHandler'));

export default api;
