import { sign, verify } from 'hono/jwt';

export interface JWTPayload {
  id: string;
  email: string;
  exp?: number;
}

export async function createToken(payload: JWTPayload, env: any): Promise<string> {
  const secret = env?.JWT_SECRET || 'your-super-secret-key-change-in-production';
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  return sign({ ...payload, exp }, secret, "HS256");
}

export async function verifyToken(token: string, env: any): Promise<JWTPayload | null> {
  const secret = env?.JWT_SECRET || 'your-super-secret-key-change-in-production';
  try {
    const decoded = await verify(token, secret, "HS256");
    return decoded as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
