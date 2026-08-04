type Request = any; type Response = any; type NextFunction = any;
import { createUser } from '../services/user';
import { getDatabase } from '../database/db';
import { getCurrentUser } from '../auth/auth';

export const postHandler = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });
    if (String(password).length < 10) return res.status(400).json({ error: 'Password must contain at least 10 characters' });

    const db = await getDatabase(req.env);
    const hasUsers = Boolean(db.data?.users?.length);
    if (hasUsers) {
      const currentUser = await getCurrentUser(req.headers.authorization, req.env);
      if (!currentUser) return res.status(403).json({ error: 'Only an authenticated administrator can create another account' });
    }

    const newUser = await createUser(email, password, name, req.env);
    if (!newUser) return res.status(400).json({ error: 'Registration failed' });

    return res.status(201).json({ message: 'User registered successfully', user: { id: newUser.id, name: newUser.name, email: newUser.email } });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Registration failed' });
  }
}
