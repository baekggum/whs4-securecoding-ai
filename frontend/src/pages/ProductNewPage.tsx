import { useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as productApi from "../api/products";
import { ApiError } from "../api/client";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function ProductNewPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (!file) {
      setImage(null);
      setPreview(null);
      return;
    }
    // Client-side checks are UX-only; the server independently re-validates
    // magic bytes, size, and re-encodes the image (docs/architecture.md §6).
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("jpg, png, webp 형식의 이미지만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("이미지 크기는 5MB 이하여야 합니다.");
      return;
    }
    setImage(file);
    setPreview(URL.createObjectURL(file));
  }

  const canSubmit = name.trim().length > 0 && description.trim().length > 0 && price !== "" && Number(price) >= 0 && !!image;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !image) return;
    setSubmitting(true);
    setError(null);
    try {
      const { product } = await productApi.createProduct({
        name: name.trim(),
        description: description.trim(),
        price: Number(price),
        image,
      });
      navigate(`/products/${product.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "상품 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 520, margin: "24px auto" }}>
      <h1>새 상품 등록</h1>
      {error && <div className="form-error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="image">상품 사진</label>
          <input id="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} required />
          {preview && (
            <img src={preview} alt="상품 사진 미리보기" style={{ maxWidth: "100%", borderRadius: 8, marginTop: 8 }} />
          )}
        </div>
        <div className="form-field">
          <label htmlFor="name">상품명</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </div>
        <div className="form-field">
          <label htmlFor="price">가격 (원)</label>
          <input id="price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} required />
        </div>
        <div className="form-field">
          <label htmlFor="description">상품 설명</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={2000}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={!canSubmit || submitting} style={{ width: "100%" }}>
          {submitting ? "등록 중..." : "등록하기"}
        </button>
      </form>
    </div>
  );
}
