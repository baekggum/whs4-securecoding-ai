import { useEffect, useState } from "react";
import { Badge } from "../components/Badge";
import * as adminApi from "../api/admin";
import type { AdminReport, AdminUserSummary, Product, Transfer } from "../types";

function UsersTab() {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    adminApi
      .listUsers()
      .then(({ items }) => setUsers(items))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggle(u: AdminUserSummary) {
    if (u.status === "active") await adminApi.setUserDormant(u.id);
    else await adminApi.activateUser(u.id);
    load();
  }

  if (loading) return <p>불러오는 중...</p>;

  return (
    <div>
      {users.map((u) => (
        <div key={u.id} className="my-product-row">
          <div>
            <strong>{u.username}</strong>{" "}
            {u.role === "admin" && <Badge>관리자</Badge>}{" "}
            {u.status === "dormant" && <Badge variant="muted">휴면</Badge>}
            <div style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>신고 누적: {u.reportCount}</div>
          </div>
          <button className="btn" onClick={() => toggle(u)}>
            {u.status === "active" ? "휴면 처리" : "휴면 해제"}
          </button>
        </div>
      ))}
    </div>
  );
}

function ProductsTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    adminApi
      .listProducts()
      .then(({ items }) => setProducts(items))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleUnblock(id: string) {
    await adminApi.unblockProduct(id);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("이 상품을 강제 삭제하시겠습니까?")) return;
    await adminApi.deleteProduct(id);
    load();
  }

  if (loading) return <p>불러오는 중...</p>;

  return (
    <div>
      {products.map((p) => (
        <div key={p.id} className="my-product-row">
          <div>
            <strong>{p.name}</strong> {p.status === "blocked" && <Badge variant="muted">차단됨</Badge>}
            <div style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>
              판매자: {p.seller?.username ?? p.sellerId} · 신고 누적: {p.reportCount}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {p.status === "blocked" && (
              <button className="btn" onClick={() => handleUnblock(p.id)}>
                차단 해제
              </button>
            )}
            <button className="btn btn-danger" onClick={() => handleDelete(p.id)}>
              강제 삭제
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportsTab() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  function load() {
    setLoading(true);
    adminApi
      .listReports(showResolved ? undefined : false)
      .then(({ items }) => setReports(items))
      .finally(() => setLoading(false));
  }

  useEffect(load, [showResolved]);

  async function handleResolve(id: string) {
    await adminApi.resolveReport(id);
    load();
  }

  if (loading) return <p>불러오는 중...</p>;

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontWeight: 400 }}>
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
        처리 완료된 신고도 표시
      </label>
      {reports.length === 0 ? (
        <div className="empty-state">신고가 없습니다.</div>
      ) : (
        reports.map((r) => (
          <div key={r.id} className="my-product-row" style={{ alignItems: "flex-start" }}>
            <div>
              <strong>
                {r.targetType === "user" ? "유저 신고" : "상품 신고"}: {r.target?.label ?? "(삭제된 대상)"}
              </strong>
              {r.resolved && <Badge>처리완료</Badge>}
              <div style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>신고자: {r.reporter?.username}</div>
              <div style={{ marginTop: 4 }}>{r.reason}</div>
            </div>
            {!r.resolved && (
              <button className="btn" onClick={() => handleResolve(r.id)}>
                처리 완료
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function TransactionsTab() {
  const [transactions, setTransactions] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .listAllTransactions()
      .then(({ items }) => setTransactions(items))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>불러오는 중...</p>;

  return (
    <div>
      {transactions.length === 0 ? (
        <div className="empty-state">송금 내역이 없습니다.</div>
      ) : (
        transactions.map((t) => (
          <div key={t.id} className="my-product-row">
            <div style={{ fontSize: "0.85rem" }}>
              <div>
                {t.senderId} → {t.receiverId}
              </div>
              <div style={{ color: "var(--color-muted)" }}>{new Date(t.createdAt).toLocaleString()}</div>
            </div>
            <strong>{Number(t.amount).toLocaleString()}P</strong>
          </div>
        ))
      )}
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<"users" | "products" | "reports" | "transactions">("users");

  return (
    <div className="card" style={{ maxWidth: 800, margin: "24px auto" }}>
      <h1>관리자 페이지</h1>
      <div className="tab-bar">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          유저
        </button>
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>
          상품
        </button>
        <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>
          신고
        </button>
        <button className={tab === "transactions" ? "active" : ""} onClick={() => setTab("transactions")}>
          송금 내역
        </button>
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "transactions" && <TransactionsTab />}
    </div>
  );
}
