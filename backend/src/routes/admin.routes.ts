import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/admin";
import {
  adminIdParamSchema,
  adminListQuerySchema,
  adminReportListQuerySchema,
  adminTransferListQuerySchema,
} from "../validators/admin.schema";
import * as adminService from "../services/admin.service";
import * as walletService from "../services/wallet.service";

export const adminRouter = Router();

// Every admin route requires both a valid session AND role === "admin" —
// requireAuth re-derives req.currentUser from the DB on every request, so
// requireAdmin needs no query of its own and a demotion takes effect
// immediately on the next request (docs/architecture.md §9.2).
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const { cursor, limit } = adminListQuerySchema.parse(req.query);
    res.json(await adminService.listUsers(cursor, limit));
  })
);

adminRouter.patch(
  "/users/:id/dormant",
  asyncHandler(async (req, res) => {
    const { id } = adminIdParamSchema.parse(req.params);
    const user = await adminService.setUserDormant(id);
    res.json({ user });
  })
);

adminRouter.patch(
  "/users/:id/activate",
  asyncHandler(async (req, res) => {
    const { id } = adminIdParamSchema.parse(req.params);
    const user = await adminService.activateUser(id);
    res.json({ user });
  })
);

adminRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const { cursor, limit } = adminListQuerySchema.parse(req.query);
    res.json(await adminService.listProductsAdmin(cursor, limit));
  })
);

adminRouter.delete(
  "/products/:id",
  asyncHandler(async (req, res) => {
    const { id } = adminIdParamSchema.parse(req.params);
    await adminService.deleteProductAdmin(id);
    res.status(204).send();
  })
);

adminRouter.patch(
  "/products/:id/unblock",
  asyncHandler(async (req, res) => {
    const { id } = adminIdParamSchema.parse(req.params);
    const product = await adminService.unblockProduct(id);
    res.json({ product });
  })
);

adminRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const { cursor, limit, resolved } = adminReportListQuerySchema.parse(req.query);
    const parsedResolved = resolved === undefined ? undefined : resolved === "true";
    res.json(await adminService.listReports(cursor, limit, parsedResolved));
  })
);

adminRouter.patch(
  "/reports/:id/resolve",
  asyncHandler(async (req, res) => {
    const { id } = adminIdParamSchema.parse(req.params);
    const report = await adminService.resolveReport(id, req.currentUser!.id);
    res.json({ report });
  })
);

adminRouter.get(
  "/wallet/transactions",
  asyncHandler(async (req, res) => {
    const { cursor, limit, senderId, receiverId, before } = adminTransferListQuerySchema.parse(req.query);
    res.json(await walletService.listAllTransactions({ cursor, limit, senderId, receiverId, before }));
  })
);
