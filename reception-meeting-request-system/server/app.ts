import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { HttpError } from "./lib/errors.js";

const app: Express = express();

app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use("/api", (_request: express.Request, response: express.Response) => {
  response.status(404).json({ message: "API route not found." });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const statusCode =
    error instanceof HttpError
      ? error.statusCode
      : typeof error === "object" && error !== null && "status" in error && error.status === 413
        ? 413
        : 500;
  const message =
    error instanceof HttpError
      ? error.message
      : statusCode === 413
        ? "The submitted data is too large."
        : "The request could not be completed.";
  if (statusCode >= 500) logger.error({ err: error }, "API request failed");
  response.status(statusCode).json({ message });
});

export default app;
