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

export async function recordLogin(user: User, env: any) {
  const db = await getDatabase(env);
  if (!db.data) return;
  const stored = db.data.users.find(item => item.id === user.id);
  if (!stored) return;
  const now = new Date().toISOString();
  stored.lastLoginAt = now;
  stored.lastActiveAt = now;
  stored.loginCount = (Number(stored.loginCount) || 0) + 1;
  await db.write();
}

export async function touchUserActivity(userId: string, env: any) {
  const db = await getDatabase(env);
  const user = db.data?.users.find(item => item.id === userId);
  if (!db.data || !user) return;
  const now = Date.now();
  const previous = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : now;
  const elapsedMinutes = Math.max(0, (now - previous) / 60000);
  if (elapsedMinutes < 1) return;
  user.usageMinutes = (Number(user.usageMinutes) || 0) + Math.min(5, elapsedMinutes);
  user.lastActiveAt = new Date(now).toISOString();
  await db.write();
}
