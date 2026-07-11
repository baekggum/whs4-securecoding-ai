import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import {
  createProductSchema,
  productIdParamSchema,
  productListQuerySchema,
  updateProductSchema,
} from "../validators/product.schema";
import * as productService from "../services/product.service";
import { productImageUpload } from "../upload/multer";
import { processAndStoreProductImage } from "../upload/imageProcessor";
import { HttpError } from "../lib/HttpError";

export const productRouter = Router();

productRouter.post(
  "/",
  requireAuth,
  productImageUpload.single("image"),
  asyncHandler(async (req, res) => {
    const input = createProductSchema.parse(req.body);

    if (!req.file) {
      throw new HttpError(400, "상품 사진을 1장 이상 첨부해주세요.");
    }

    const imagePath = await processAndStoreProductImage(req.file.buffer);

    const product = await productService.createProduct(req.currentUser!.id, {
      ...input,
      imagePath,
    });

    res.status(201).json({ product });
  })
);

productRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { cursor, limit, sellerId } = productListQuerySchema.parse(req.query);
    const result = await productService.listProducts(cursor, limit, sellerId);
    res.json(result);
  })
);

productRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const products = await productService.listMyProducts(req.currentUser!.id);
    res.json({ products });
  })
);

// attachCurrentUser already runs globally, so req.currentUser may be set
// here even without requireAuth — detail visibility depends on who (if
// anyone) is viewing, per docs/architecture.md §4.
productRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = productIdParamSchema.parse(req.params);
    const product = await productService.getProductDetail(id, req.currentUser?.id);
    res.json({ product });
  })
);

productRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = productIdParamSchema.parse(req.params);
    const input = updateProductSchema.parse(req.body);
    const product = await productService.updateProduct(id, req.currentUser!.id, input);
    res.json({ product });
  })
);

productRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = productIdParamSchema.parse(req.params);
    await productService.deleteProduct(id, req.currentUser!.id);
    res.status(204).send();
  })
);
