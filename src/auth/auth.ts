import { extractTokenFromHeader, verifyToken } from './jwt';
import { findUserById } from '../services/user';
import { User } from '../database/db';

export async function getCurrentUser(authHeader?: string, env?: any) {
  const token = extractTokenFromHeader(authHeader);
  if (!token) {
    return null;
  }

  const payload = await verifyToken(token, env);
  if (!payload) {
    return null;
  }

  const user = await findUserById(payload.id, env);
  if (!user || user.status === 'suspended' || user.status === 'invited') return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'owner',
    permissions: user.permissions || []
  };
}
