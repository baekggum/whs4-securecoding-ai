import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Badge } from "../components/Badge";
import { Loading } from "../components/Loading";
import { useAsyncData } from "../hooks/useAsyncData";
import { useStartChat } from "../hooks/useStartChat";
import * as productApi from "../api/products";
import { ApiError, API_BASE_URL } from "../api/client";

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { startChat, starting: startingChat, error: chatError } = useStartChat();

  const { data, loading, error } = useAsyncData(
    () => (id ? productApi.getProduct(id) : Promise.resolve(null)),
    [id]
  );
  const product = data?.product ?? null;

  if (error instanceof ApiError && error.status === 404) {
    return <div className="empty-state">상품을 찾을 수 없습니다.</div>;
  }
  if (error) {
    return <div className="empty-state">상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>;
  }
  if (loading || !product) {
    return <Loading />;
  }

  const isOwner = user?.id === product.sellerId;
  const sellerDormant = product.seller?.status === "dormant";

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
          <button className="btn btn-primary" onClick={() => startChat(product.sellerId)} disabled={startingChat}>
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
