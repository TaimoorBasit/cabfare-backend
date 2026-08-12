type Request = any; type Response = any;
import { randomUUID } from 'node:crypto';
import { addActivity, getDatabase, User } from '../database/db';
import { ALL_PERMISSIONS, issueAccessToken, permissionsFor } from '../services/access';

const publicUser = (user: User, activities: any[]) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role || 'admin',
  permissions: permissionsFor(user),
  status: user.status || 'active',
  createdAt: user.createdAt,
  inviteExpiresAt: user.inviteExpiresAt,
  lastLoginAt: user.lastLoginAt,
  lastActiveAt: user.lastActiveAt,
  usageMinutes: Math.round(Number(user.usageMinutes) || 0),
  usageSeconds: Number(user.usageSeconds) || 0,
  loginCount: Number(user.loginCount) || 0,
  sessionStartedAt: user.sessionStartedAt,
  sessionLastSeenAt: user.sessionLastSeenAt,
  usageByDate: user.usageByDate || {},
  activities: activities.filter(item => item.actorId === user.id)
});

const accessLink = (baseUrl: string, token: string, mode: 'invite' | 'reset') =>
  `${String(baseUrl || '').replace(/\/$/, '')}/?access=${mode}&token=${encodeURIComponent(token)}`;

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const activities = db.data?.activityLog || [];
  return res.json({ staff: (db.data?.users || []).map(user => publicUser(user, activities)), permissions: ALL_PERMISSIONS });
};

export const inviteHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = ['admin', 'quotes', 'custom'].includes(req.body.role) ? req.body.role : 'quotes';
  const permissions = role === 'custom' ? (req.body.permissions || []).filter((item: string) => ALL_PERMISSIONS.includes(item) && item !== 'staff') : [];
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid name and email are required' });
  const existing = db.data.users.find(user => user.email.toLowerCase() === email);
  if (existing) {
    if (existing.status !== 'invited') return res.status(409).json({ error: 'An active account already uses this email' });
    Object.assign(existing, { name, role, permissions });
    const invitation = issueAccessToken(existing, 'invite');
    addActivity(db, 'staff', `Resent invitation to ${name}`, req.adminUser);
    await db.write();
    return res.json({ staff: publicUser(existing, db.data.activityLog || []), link: accessLink(req.body.baseUrl, invitation.token, 'invite'), expiresAt: invitation.expiresAt });
  }
  const user: User = {
    id: randomUUID(), name, email, passwordHash: '', createdAt: new Date().toISOString(),
    role, permissions, status: 'invited', usageMinutes: 0, loginCount: 0
  };
  const invitation = issueAccessToken(user, 'invite');
  db.data.users.push(user);
  addActivity(db, 'staff', `Invited ${name} as ${role}`, req.adminUser);
  await db.write();
  return res.status(201).json({ staff: publicUser(user, []), link: accessLink(req.body.baseUrl, invitation.token, 'invite'), expiresAt: invitation.expiresAt });
};

export const putHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const user = db.data?.users.find(item => item.id === req.body.id);
  if (!db.data || !user) return res.status(404).json({ error: 'Staff member not found' });
  if (user.role === 'owner') return res.status(400).json({ error: 'The owner account cannot be changed here' });
  const before = { role: user.role, status: user.status, permissions: permissionsFor(user) };
  if (['admin', 'quotes', 'custom'].includes(req.body.role)) user.role = req.body.role;
  if (user.role === 'custom' && Array.isArray(req.body.permissions)) {
    user.permissions = req.body.permissions.filter((item: string) => ALL_PERMISSIONS.includes(item) && item !== 'staff');
  }
  if (['active', 'suspended'].includes(req.body.status)) user.status = req.body.status;
  const after = { role: user.role, status: user.status, permissions: permissionsFor(user) };
  addActivity(db, 'staff', `Updated access for ${user.name}`, req.adminUser, [{ field: 'access', before, after }]);
  await db.write();
  return res.json({ staff: publicUser(user, db.data.activityLog || []) });
};

export const resendHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const user = db.data?.users.find(item => item.id === req.body.id);
  if (!db.data || !user || user.status !== 'invited') return res.status(404).json({ error: 'Pending invitation not found' });
  const invitation = issueAccessToken(user, 'invite');
  addActivity(db, 'staff', `Resent invitation to ${user.name}`, req.adminUser);
  await db.write();
  return res.json({ link: accessLink(req.body.baseUrl, invitation.token, 'invite'), expiresAt: invitation.expiresAt, staff: publicUser(user, db.data.activityLog || []) });
};

export const resetHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const user = db.data?.users.find(item => item.id === req.body.id);
  if (!db.data || !user || user.status !== 'active') return res.status(404).json({ error: 'Active staff member not found' });
  const reset = issueAccessToken(user, 'reset');
  addActivity(db, 'staff', `Sent a password reset to ${user.name}`, req.adminUser);
  await db.write();
  return res.json({ link: accessLink(req.body.baseUrl, reset.token, 'reset'), expiresAt: reset.expiresAt, staff: publicUser(user, db.data.activityLog || []) });
};

export const deleteHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const index = db.data?.users.findIndex(item => item.id === req.body.id) ?? -1;
  if (!db.data || index < 0) return res.status(404).json({ error: 'Staff member not found' });
  const user = db.data.users[index];
  if (user.role === 'owner') return res.status(400).json({ error: 'The owner account cannot be removed' });
  db.data.users.splice(index, 1);
  addActivity(db, 'staff', `Removed ${user.name}`, req.adminUser);
  await db.write();
  return res.json({ success: true });
};
