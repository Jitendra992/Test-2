// Vercel serverless entry. vercel.json routes every /api/* request here and the
// Express app serves it. Local development uses server/dev.ts instead.
import app from "../server/app.js";

export default app;
