import { sign, verify } from 'hono/jwt';

export interface JWTPayload {
  id: string;
  email: string;
  exp?: number;
}

function jwtSecret(env: any): string {
  const secret = env?.JWT_SECRET;
  if (!secret || String(secret).length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }
  return String(secret);
}

export async function createToken(payload: JWTPayload, env: any): Promise<string> {
  const secret = jwtSecret(env);
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; 
  return sign({ ...payload, exp }, secret, "HS256");
}

export async function verifyToken(token: string, env: any): Promise<JWTPayload | null> {
  const secret = jwtSecret(env);
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
