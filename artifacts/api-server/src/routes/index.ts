import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import staffRouter from "./staff";
import businessRouter from "./business";
import storageRouter from "./storage";
import approvalsRouter from "./approvals";
import returnsRouter from "./returns";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(staffRouter);
router.use(businessRouter);
router.use(storageRouter);
router.use(approvalsRouter);
router.use(returnsRouter);
router.use(dashboardRouter);

export default router;
