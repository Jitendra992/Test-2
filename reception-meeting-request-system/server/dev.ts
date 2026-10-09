// Local API server used by `npm run dev` (Vite proxies /api to it).
// On Vercel this file is not used; see api/index.ts.
import "dotenv/config";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { storageDescription, storageKind } from "./lib/app-data.js";

const port = Number(process.env.API_PORT || 3001);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid API_PORT value: "${process.env.API_PORT}"`);
}

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port, storage: storageKind, location: storageDescription }, "API server listening");
});
