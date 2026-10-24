import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transcriptionRouter from "./transcription";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transcriptionRouter);

export default router;
