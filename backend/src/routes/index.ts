import { Router } from "express";
import { authRouter } from "./auth.routes";
import { csrfRouter } from "./csrf.routes";
import { userRouter } from "./user.routes";
import { productRouter } from "./product.routes";
import { reportRouter } from "./report.routes";
import { chatRouter } from "./chat.routes";

export const apiRouter = Router();

apiRouter.use(csrfRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/products", productRouter);
apiRouter.use("/reports", reportRouter);
apiRouter.use("/chat", chatRouter);
