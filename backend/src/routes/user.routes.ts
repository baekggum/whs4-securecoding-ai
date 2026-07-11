import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { updateBioSchema, updatePasswordSchema, userIdParamSchema } from "../validators/user.schema";
import * as userService from "../services/user.service";

export const userRouter = Router();

userRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.currentUser!;
    res.json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  })
);

userRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateBioSchema.parse(req.body);
    const user = await userService.updateBio(req.currentUser!.id, input.bio);
    res.json({ user });
  })
);

userRouter.patch(
  "/me/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updatePasswordSchema.parse(req.body);
    await userService.updatePassword(req.currentUser!.id, input.currentPassword, input.newPassword);
    res.status(204).send();
  })
);

userRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = userIdParamSchema.parse(req.params);
    const user = await userService.getPublicProfile(id);
    res.json({ user });
  })
);
