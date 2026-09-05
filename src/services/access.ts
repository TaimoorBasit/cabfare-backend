import { createHash, randomBytes } from 'node:crypto';
import { addActivity, getDatabase, User } from '../database/db';
import { hashPassword } from './user';

export const ALL_PERMISSIONS = ['dashboard', 'quotes', 'bookings', 'fleet', 'pricing', 'reports', 'settings', 'staff'];

export function permissionsFor(user: Pick<User, 'role' | 'permissions'>) {
  if (!user.role || user.role === 'owner') return ALL_PERMISSIONS;
  if (user.role === 'admin') return ALL_PERMISSIONS.filter(permission => permission !== 'staff');
  if (user.role === 'quotes') return ['bookings'];
  return [...new Set((user.permissions || []).map(permission => permission === 'quotes' ? 'bookings' : permission).filter(permission => ALL_PERMISSIONS.includes(permission)))];
}

export function can(user: any, permission: string) {
  return permissionsFor(user || {}).includes(permission);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function issueAccessToken(user: User, kind: 'invite' | 'reset') {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (kind === 'invite' ? 48 : 1) * 60 * 60 * 1000).toISOString();
  if (kind === 'invite') {
    user.inviteTokenHash = tokenHash(token);
    user.inviteExpiresAt = expiresAt;
  } else {
    user.resetTokenHash = tokenHash(token);
    user.resetExpiresAt = expiresAt;
  }
  return { token, expiresAt };
}

export async function consumeAccessToken(token: string, password: string, kind: 'invite' | 'reset', env: any) {
  if (String(password).length < 10) throw new Error('Password must contain at least 10 characters');
  const db = await getDatabase(env);
  if (!db.data) throw new Error('Database not initialized');
  const hash = tokenHash(String(token || ''));
  const hashField = kind === 'invite' ? 'inviteTokenHash' : 'resetTokenHash';
  const expiryField = kind === 'invite' ? 'inviteExpiresAt' : 'resetExpiresAt';
  const user = db.data.users.find(item => item[hashField] === hash);
  if (!user || !user[expiryField] || new Date(user[expiryField]!).getTime() <= Date.now()) {
    throw new Error('This secure link is invalid or has expired');
  }
  user.passwordHash = await hashPassword(password);
  user.status = 'active';
  delete user[hashField];
  delete user[expiryField];
  addActivity(db, 'access', `${user.name} ${kind === 'invite' ? 'accepted an invitation' : 'reset their password'}`, user);
  await db.writeSections({ users: db.data.users, activityLog: db.data.activityLog });
  return user;
}
