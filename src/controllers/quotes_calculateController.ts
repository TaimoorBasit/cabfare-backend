type Request = any; type Response = any; type NextFunction = any;
import { generateQuotes, QuoteValidationError } from '../engines/quoteEngine';
import { MileageUnavailableError } from '../engines/mileageEngine';
import { PricingConfigurationError } from '../engines/pricingEngine';

export const postHandler = async (req: Request, res: Response) => {
  try {
    const journey = req.body;
    const quotes = await generateQuotes(journey, req.env);
    return res.json({ quotes });
  } catch (error: any) {
    console.error("Quote calculation error:", error);
    const status = error instanceof QuoteValidationError
      ? 400
      : error instanceof PricingConfigurationError
        ? 422
        : error instanceof MileageUnavailableError
          ? 503
          : 500;
    return res.status(status).json({
      error: status === 500 ? 'Quote calculation failed unexpectedly' : error.message
    });
  }
}
