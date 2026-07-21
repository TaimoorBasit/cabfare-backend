type Request = any; type Response = any; type NextFunction = any;
import { verifyToken } from '../auth/jwt';
import { findUserById } from '../services/user';

export const getHandler = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    const decoded = await verifyToken(token, req.env);
    if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });

    const user = await findUserById((decoded as any).id, req.env);
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
