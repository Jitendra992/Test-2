import { Router, type IRouter } from "express";
import authRouter from "./auth.js";
import healthRouter from "./health.js";
import receptionRouter from "./reception.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(receptionRouter);

export default router;
