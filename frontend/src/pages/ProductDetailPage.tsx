import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Badge } from "../components/Badge";
import * as productApi from "../api/products";
import * as chatApi from "../api/chat";
import { ApiError, API_BASE_URL } from "../api/client";
import type { Product } from "../types";

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setProduct(null);
    setNotFound(false);
    productApi
      .getProduct(id)
      .then(({ product: p }) => setProduct(p))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else throw err;
      });
  }, [id]);

  if (notFound) {
    return <div className="empty-state">상품을 찾을 수 없습니다.</div>;
  }
  if (!product) {
    return <p>불러오는 중...</p>;
  }

  const isOwner = user?.id === product.sellerId;
  const sellerDormant = product.seller?.status === "dormant";

  async function handleStartChat() {
    if (!user) {
      navigate("/login");
      return;
    }
    setStartingChat(true);
    setChatError(null);
    try {
      const { room } = await chatApi.startDirectRoom(product!.sellerId);
      navigate(`/chat/${room.id}`);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "채팅을 시작할 수 없습니다.");
    } finally {
      setStartingChat(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640, margin: "24px auto" }}>
      {product.status === "blocked" && (
        <div className="form-error-banner">
          ⚠ 이 상품은 신고 접수로 검토 중이며, 다른 사용자에게 노출되지 않습니다.
        </div>
      )}
      {product.imagePath && (
        <img
          className="product-detail-image"
          src={`${API_BASE_URL}/uploads/products/${product.imagePath}`}
          alt={product.name}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
        <h1 style={{ margin: 0 }}>{product.name}</h1>
        {product.status === "blocked" && <Badge variant="muted">신고로 노출 제한됨</Badge>}
      </div>
      <p style={{ fontSize: "1.3rem", fontWeight: 700 }}>{product.price.toLocaleString()}원</p>
      <p style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>
        등록일 {new Date(product.createdAt).toLocaleDateString()}
      </p>

      <div className="card" style={{ margin: "12px 0" }}>
        <Link to={`/users/${product.sellerId}`}>{product.seller?.username ?? "판매자"}</Link>
        {sellerDormant && <Badge variant="muted"> 휴면계정</Badge>}
      </div>

      <p style={{ whiteSpace: "pre-wrap" }}>{product.description}</p>

      {chatError && <div className="inline-error">{chatError}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {isOwner ? (
          <Link className="btn" to="/mypage">
            내 상품 관리하기
          </Link>
        ) : sellerDormant ? (
          <button className="btn" disabled>
            휴면 계정 판매자에게는 채팅을 시작할 수 없습니다
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleStartChat} disabled={startingChat}>
            💬 채팅하기
          </button>
        )}
        {!isOwner && user && (
          <Link className="btn" to={`/report?targetType=product&targetId=${product.id}&targetName=${encodeURIComponent(product.name)}`}>
            상품 신고하기
          </Link>
        )}
      </div>
    </div>
  );
}
