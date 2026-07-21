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
  
  const existingUser = db.data.users.find((u: User) => u.email === email);
  if (existingUser) return null; // Email already in use

  const passwordHash = await hashPassword(password);

  const newUser: User = {
    id: Date.now().toString(), // basic id generation
    email,
    passwordHash,
    name,
    createdAt: new Date().toISOString()
  };

  db.data.users.push(newUser);
  await db.write();

  return newUser;
}

export async function findUserByEmail(email: string, env: any): Promise<User | null> {
  const db = await getDatabase(env);
  if (!db.data) return null;
  return db.data.users.find((u: User) => u.email === email) || null;
}

export async function findUserById(id: string, env: any): Promise<User | null> {
  const db = await getDatabase(env);
  if (!db.data) return null;
  return db.data.users.find((u: User) => u.id === id) || null;
}

export async function authenticateUser(email: string, password: string, env: any): Promise<User | null> {
  const user = await findUserByEmail(email, env);
  if (!user) {
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  return valid ? user : null;
}
