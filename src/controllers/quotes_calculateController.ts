type Request = any; type Response = any; type NextFunction = any;
import { generateQuotes, QuoteValidationError } from '../engines/quoteEngine';

export const postHandler = async (req: Request, res: Response) => {
  try {
    const journey = req.body;
    const quotes = await generateQuotes(journey, req.env);
    return res.json({ quotes });
  } catch (error: any) {
    console.error("Quote calculation error:", error);
    return res.status(error instanceof QuoteValidationError ? 400 : 500).json({ error: error.message });
  }
}
