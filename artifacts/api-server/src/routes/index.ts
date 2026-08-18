import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import staffRouter from "./staff";
import businessRouter from "./business";
import storageRouter from "./storage";
import approvalsRouter from "./approvals";
import returnsRouter from "./returns";
import dashboardRouter from "./dashboard";
import dealersRouter from "./dealers";
import syncRouter from "./sync";
import appUpdatesRouter from "./appUpdates";
import roleFeaturesRouter from "./roleFeatures";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(staffRouter);
router.use(dealersRouter);
router.use(businessRouter);
router.use(storageRouter);
router.use(approvalsRouter);
router.use(returnsRouter);
router.use(dashboardRouter);
router.use(syncRouter);
router.use(appUpdatesRouter);
router.use(roleFeaturesRouter);
router.use(notificationsRouter);

export default router;
