import { extractTokenFromHeader, verifyToken } from './jwt';
import { findUserById } from '../services/user';
import { User } from '../database/db';

interface CachedUser {
  user: { id: string; email: string; name: string; role: string; permissions: string[] };
  expiresAt: number;
}

const userCache = new Map<string, CachedUser>();
const USER_CACHE_TTL_MS = 30_000;

export function invalidateUserCache(userId?: string) {
  if (userId) {
    userCache.delete(userId);
  } else {
    userCache.clear();
  }
}

export async function getCurrentUser(authHeader?: string, env?: any) {
  const token = extractTokenFromHeader(authHeader);
  if (!token) {
    return null;
  }

  const payload = await verifyToken(token, env);
  if (!payload || !payload.id) {
    return null;
  }

  const now = Date.now();
  const cached = userCache.get(payload.id);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  const user = await findUserById(payload.id, env);
  if (!user || user.status === 'suspended' || user.status === 'invited') {
    userCache.delete(payload.id);
    return null;
  }

  const sanitized = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'owner',
    permissions: user.permissions || []
  };

  userCache.set(payload.id, {
    user: sanitized,
    expiresAt: now + USER_CACHE_TTL_MS
  });

  return sanitized;
}
