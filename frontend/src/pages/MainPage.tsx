import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ProductCard } from "../components/ProductCard";
import { ChatPanel } from "../components/ChatPanel";
import * as productApi from "../api/products";
import * as chatApi from "../api/chat";
import type { ProductListItem } from "../types";

export function MainPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalRoomId, setGlobalRoomId] = useState<string | null>(null);

  useEffect(() => {
    productApi.listProducts().then(({ items, nextCursor }) => {
      setProducts(items);
      setCursor(nextCursor);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setGlobalRoomId(null);
      return;
    }
    chatApi.listMyRooms().then(({ rooms }) => {
      const globalRoom = rooms.find((r) => r.type === "global");
      setGlobalRoomId(globalRoom?.id ?? null);
    });
  }, [user]);

  async function loadMore() {
    if (!cursor) return;
    const { items, nextCursor } = await productApi.listProducts(cursor);
    setProducts((prev) => [...prev, ...items]);
    setCursor(nextCursor);
  }

  return (
    <div className="main-layout">
      <section>
        <h2>전체 상품</h2>
        {loading ? (
          <p>불러오는 중...</p>
        ) : products.length === 0 ? (
          <div className="empty-state">등록된 상품이 없습니다.</div>
        ) : (
          <>
            <div className="product-grid">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            {cursor && (
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button className="btn" onClick={loadMore}>
                  더 보기
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <section>
        <h2>실시간 전체채팅</h2>
        {user && globalRoomId ? (
          <ChatPanel roomId={globalRoomId} title="전체채팅" />
        ) : (
          <div className="card empty-state">
            <Link to="/login">로그인</Link> 후 전체채팅에 참여할 수 있습니다.
          </div>
        )}
      </section>
    </div>
  );
}
