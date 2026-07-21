type Request = any; type Response = any; type NextFunction = any;
import { authenticateUser } from '../services/user';
import { createToken } from '../auth/jwt';

export const postHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing required fields: email, password' });

    const user = await authenticateUser(email, password, req.env);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const token = await createToken({ id: user.id, email: user.email }, req.env);
    return res.json({ message: 'Login successful', token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Login failed' });
  }
}
