import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getDatabase, User } from '../database/db';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createUser(email: string, password: string, name: string, env: any): Promise<User | null> {
  const db = await getDatabase(env);
  if (!db.data) return null;

  const normalizedEmail = String(email).trim().toLowerCase();
  const existingUser = db.data.users.find(
    (u: User) => String(u.email).trim().toLowerCase() === normalizedEmail
  );
  if (existingUser) return null; 

  const passwordHash = await hashPassword(password);

  const newUser: User = {
    id: Date.now().toString(), 
    email: normalizedEmail,
    passwordHash,
    name,
    createdAt: new Date().toISOString(),
    role: db.data.users.length === 0 ? 'owner' : 'admin',
    permissions: [],
    status: 'active',
    usageMinutes: 0,
    loginCount: 0
  };

  db.data.users.push(newUser);
  await db.write();

  return newUser;
}

export async function findUserByEmail(email: string, env: any): Promise<User | null> {
  const db = await getDatabase(env);
  if (!db.data) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  return db.data.users.find(
    (u: User) => String(u.email).trim().toLowerCase() === normalizedEmail
  ) || null;
}

export async function findUserById(id: string, env: any): Promise<User | null> {
  const db = await getDatabase(env);
  if (!db.data) return null;
  return db.data.users.find((u: User) => u.id === id) || null;
}

export async function authenticateUser(email: string, password: string, env: any): Promise<User | null> {
  const user = await findUserByEmail(email, env);
  if (!user || user.status === 'suspended' || user.status === 'invited' || !user.passwordHash) {
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  return valid ? user : null;
}

export function recordDailyUsage(user: User, now: Date, minutes = 0, login = false) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
  user.usageByDate ||= {};
  const daily = user.usageByDate[day] ||= { minutes: 0, logins: 0 };
  daily.minutes += minutes;
  if (login) { daily.logins += 1; daily.lastLoginAt = now.toISOString(); }
  daily.lastActiveAt = now.toISOString();
}

export function recordSessionTime(user: User, now: Date, stop = false) {
  const previous = user.sessionLastSeenAt ? new Date(user.sessionLastSeenAt).getTime() : now.getTime();
  const seconds = Math.min(30, Math.max(0, Math.floor((now.getTime() - previous) / 1000)));
  user.usageSeconds = (Number(user.usageSeconds) || 0) + seconds;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
  user.usageByDate ||= {};
  const daily = user.usageByDate[day] ||= { minutes: 0, logins: 0 };
  daily.seconds = (Number(daily.seconds) || 0) + seconds;
  daily.lastActiveAt = now.toISOString();
  user.lastActiveAt = now.toISOString();
  if (stop) { delete user.sessionStartedAt; delete user.sessionLastSeenAt; }
  else user.sessionLastSeenAt = now.toISOString();
  return seconds;
}

export async function recordLogin(user: User, env: any) {
  const db = await getDatabase(env);
  if (!db.data) return;
  const stored = db.data.users.find(item => item.id === user.id);
  if (!stored) return;
  const now = new Date().toISOString();
  stored.lastLoginAt = now;
  stored.lastActiveAt = now;
  stored.loginCount = (Number(stored.loginCount) || 0) + 1;
  stored.sessionStartedAt = now;
  stored.sessionLastSeenAt = now;
  recordDailyUsage(stored, new Date(now), 0, true);
  await db.write();
}

export async function recordSessionHeartbeat(userId: string, env: any, stop = false) {
  const db = await getDatabase(env);
  const user = db.data?.users.find(item => item.id === userId);
  if (!db.data || !user || !user.sessionStartedAt) return;
  recordSessionTime(user, new Date(), stop);
  await db.write();
}

export async function touchUserActivity(userId: string, env: any) {
  const db = await getDatabase(env);
  const user = db.data?.users.find(item => item.id === userId);
  if (!db.data || !user) return;
  if (user.sessionStartedAt) return;
  const now = Date.now();
  const previous = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : now;
  const elapsedMinutes = Math.max(0, (now - previous) / 60000);
  if (elapsedMinutes < 1) return;
  user.usageMinutes = (Number(user.usageMinutes) || 0) + Math.min(5, elapsedMinutes);
  const addedMinutes = Math.min(5, elapsedMinutes);
  user.lastActiveAt = new Date(now).toISOString();
  recordDailyUsage(user, new Date(now), addedMinutes);
  await db.write();
}
