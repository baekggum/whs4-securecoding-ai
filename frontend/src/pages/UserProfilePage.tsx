import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Badge } from "../components/Badge";
import { ProductCard } from "../components/ProductCard";
import { Loading } from "../components/Loading";
import { useAsyncData } from "../hooks/useAsyncData";
import { useStartChat } from "../hooks/useStartChat";
import * as userApi from "../api/users";
import * as productApi from "../api/products";
import { ApiError } from "../api/client";
import type { ProductListItem } from "../types";

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { startChat, error: chatError } = useStartChat();

  const { data, loading, error } = useAsyncData(
    () => (id ? userApi.getPublicProfile(id) : Promise.resolve(null)),
    [id]
  );
  const profile = data?.user ?? null;

  // Product list failures degrade to an empty list (.catch 폴백) — the
  // profile itself must stay visible even if the list call is rejected.
  const { data: productData } = useAsyncData(
    () =>
      id
        ? productApi
            .listProducts({ sellerId: id })
            .catch((): { items: ProductListItem[]; nextCursor: string | null } => ({ items: [], nextCursor: null }))
        : Promise.resolve(null),
    [id]
  );
  const products = productData?.items ?? [];

  if (error instanceof ApiError && error.status === 404) {
    return <div className="empty-state">사용자를 찾을 수 없습니다.</div>;
  }
  if (error) {
    return <div className="empty-state">프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>;
  }
  if (loading || !profile) return <Loading />;

  const isSelf = user?.id === profile.id;

  return (
    <div className="card" style={{ maxWidth: 560, margin: "24px auto", textAlign: "center" }}>
      {profile.status === "dormant" && (
        <div className="form-error-banner">⚠ 휴면 계정입니다. 새로운 채팅을 시작할 수 없습니다.</div>
      )}
      <h1>
        {profile.username} {profile.status === "dormant" && <Badge variant="muted">휴면계정</Badge>}
      </h1>
      {profile.bio && <p>{profile.bio}</p>}
      <p style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>
        가입일 {new Date(profile.createdAt).toLocaleDateString()}
      </p>

      {chatError && <div className="inline-error">{chatError}</div>}

      {isSelf ? (
        <Link className="btn" to="/mypage">
          마이페이지로 이동
        </Link>
      ) : (
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {profile.status !== "dormant" && (
            <button className="btn btn-primary" onClick={() => startChat(profile.id)}>
              💬 채팅하기
            </button>
          )}
          {user && profile.status !== "dormant" && (
            <Link
              className="btn"
              to={`/transfer?receiverId=${profile.id}&receiverName=${encodeURIComponent(profile.username)}`}
            >
              💰 포인트 보내기
            </Link>
          )}
          <Link className="btn" to={`/report?targetType=user&targetId=${profile.id}&targetName=${encodeURIComponent(profile.username)}`}>
            이 사용자 신고하기
          </Link>
        </div>
      )}

      <h3 style={{ textAlign: "left", marginTop: 24 }}>판매중인 상품</h3>
      {products.length === 0 ? (
        <div className="empty-state">판매중인 상품이 없습니다.</div>
      ) : (
        <div className="product-grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
