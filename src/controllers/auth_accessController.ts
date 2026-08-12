type Request = any; type Response = any;
import { consumeAccessToken } from '../services/access';

const complete = (kind: 'invite' | 'reset') => async (req: Request, res: Response) => {
  try {
    const user = await consumeAccessToken(req.body.token, req.body.password, kind, req.env);
    return res.json({ success: true, email: user.email });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to complete secure access' });
  }
};

export const inviteHandler = complete('invite');
export const resetHandler = complete('reset');
