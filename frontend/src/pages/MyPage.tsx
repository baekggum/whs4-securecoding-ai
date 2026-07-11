import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Badge } from "../components/Badge";
import { Toast } from "../components/Toast";
import * as userApi from "../api/users";
import * as productApi from "../api/products";
import { ApiError } from "../api/client";
import type { Product } from "../types";

function statusBadge(product: Product) {
  if (product.status === "blocked") return <Badge variant="muted">신고로 노출 제한됨</Badge>;
  return <Badge>판매중</Badge>;
}

function ProductRow({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [description, setDescription] = useState(product.description);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await productApi.updateProduct(product.id, { name: name.trim(), price: Number(price), description: description.trim() });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await productApi.deleteProduct(product.id);
    onChanged();
  }

  if (editing) {
    return (
      <div className="my-product-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        {error && <div className="inline-error">{error}</div>}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            저장
          </button>
          <button className="btn" onClick={() => setEditing(false)}>
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="my-product-row">
      <div>
        <strong>{product.name}</strong>
        <div style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>{product.price.toLocaleString()}원</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {statusBadge(product)}
        <button className="btn" onClick={() => setEditing(true)}>
          수정
        </button>
        <button className="btn btn-danger" onClick={handleDelete}>
          삭제
        </button>
      </div>
    </div>
  );
}

export function MyPage() {
  const { user, refreshUser } = useAuth();
  const [tab, setTab] = useState<"info" | "products">("info");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [infoError, setInfoError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    setBio(user?.bio ?? "");
  }, [user]);

  function loadProducts() {
    productApi.listMyProducts().then(({ products: list }) => setProducts(list));
  }

  useEffect(() => {
    if (tab === "products") loadProducts();
  }, [tab]);

  async function handleSaveInfo(e: FormEvent) {
    e.preventDefault();
    setInfoError(null);
    try {
      await userApi.updateBio(bio);
      if (newPassword) {
        if (newPassword !== newPasswordConfirm) {
          setInfoError("새 비밀번호가 일치하지 않습니다.");
          return;
        }
        await userApi.updatePassword(currentPassword, newPassword);
        setCurrentPassword("");
        setNewPassword("");
        setNewPasswordConfirm("");
      }
      await refreshUser();
      setToast("저장되었습니다.");
    } catch (err) {
      setInfoError(err instanceof ApiError ? err.message : "저장에 실패했습니다.");
    }
  }

  if (!user) return null;

  return (
    <div className="card" style={{ maxWidth: 640, margin: "24px auto" }}>
      <h1>마이페이지</h1>
      <p>
        <strong>{user.username}</strong>
      </p>
      <div className="tab-bar">
        <button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>
          내 정보 수정
        </button>
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>
          내가 등록한 상품
        </button>
      </div>

      {tab === "info" ? (
        <form onSubmit={handleSaveInfo}>
          {infoError && <div className="form-error-banner">{infoError}</div>}
          <div className="form-field">
            <label htmlFor="bio">소개글</label>
            <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={300} />
          </div>
          <h3>비밀번호 변경</h3>
          <div className="form-field">
            <label htmlFor="currentPassword">현재 비밀번호</label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="form-field">
            <label htmlFor="newPassword">새 비밀번호</label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="form-field">
            <label htmlFor="newPasswordConfirm">새 비밀번호 확인</label>
            <input
              id="newPasswordConfirm"
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button className="btn btn-primary" type="submit">
            저장하기
          </button>
        </form>
      ) : (
        <div>
          {products.length === 0 ? (
            <div className="empty-state">등록한 상품이 없습니다.</div>
          ) : (
            products.map((p) => <ProductRow key={p.id} product={p} onChanged={loadProducts} />)
          )}
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
