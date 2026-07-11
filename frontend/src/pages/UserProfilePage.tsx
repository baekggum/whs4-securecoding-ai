import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Badge } from "../components/Badge";
import { ProductCard } from "../components/ProductCard";
import * as userApi from "../api/users";
import * as productApi from "../api/products";
import * as chatApi from "../api/chat";
import { ApiError } from "../api/client";
import type { ProductListItem, PublicUser } from "../types";

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setProfile(null);
    setNotFound(false);
    userApi
      .getPublicProfile(id)
      .then(({ user: u }) => setProfile(u))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else throw err;
      });
    productApi
      .listProducts(undefined, id)
      .then(({ items }) => setProducts(items))
      .catch(() => setProducts([]));
  }, [id]);

  if (notFound) return <div className="empty-state">사용자를 찾을 수 없습니다.</div>;
  if (!profile) return <p>불러오는 중...</p>;

  const isSelf = user?.id === profile.id;

  async function handleStartChat() {
    if (!user) {
      navigate("/login");
      return;
    }
    try {
      const { room } = await chatApi.startDirectRoom(profile!.id);
      navigate(`/chat/${room.id}`);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "채팅을 시작할 수 없습니다.");
    }
  }

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
            <button className="btn btn-primary" onClick={handleStartChat}>
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
