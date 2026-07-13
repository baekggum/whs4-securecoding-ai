import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ProductCard } from "../components/ProductCard";
import { ChatPanel } from "../components/ChatPanel";
import { Loading } from "../components/Loading";
import { useAsyncData } from "../hooks/useAsyncData";
import * as productApi from "../api/products";
import * as chatApi from "../api/chat";

export function MainPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const {
    data: productPage,
    setData: setProductPage,
    loading,
  } = useAsyncData(() => productApi.listProducts({ search: appliedSearch || undefined }), [appliedSearch]);
  const products = productPage?.items ?? [];
  const cursor = productPage?.nextCursor ?? null;

  // Room lookup failures fall back to "no global room" (.catch 폴백) — the
  // product list must render even when the chat lookup is unauthorized.
  const { data: globalRoomId } = useAsyncData(
    () =>
      user
        ? chatApi
            .listMyRooms()
            .then(({ rooms }) => rooms.find((r) => r.type === "global")?.id ?? null)
            .catch(() => null)
        : Promise.resolve(null),
    [user]
  );

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setAppliedSearch(search.trim());
  }

  async function loadMore() {
    if (!cursor) return;
    const { items, nextCursor } = await productApi.listProducts({ cursor, search: appliedSearch || undefined });
    setProductPage((prev) => ({ items: [...(prev?.items ?? []), ...items], nextCursor }));
  }

  return (
    <div className="main-layout">
      <section>
        <h2>전체 상품</h2>
        <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명, 설명 검색..."
            style={{ flex: 1, padding: "8px 12px", border: "1px solid var(--color-border)", borderRadius: 8 }}
          />
          <button className="btn" type="submit">
            검색
          </button>
          {appliedSearch && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSearch("");
                setAppliedSearch("");
              }}
            >
              초기화
            </button>
          )}
        </form>
        {loading ? (
          <Loading />
        ) : products.length === 0 ? (
          <div className="empty-state">{appliedSearch ? "검색 결과가 없습니다." : "등록된 상품이 없습니다."}</div>
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
