import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useFormSubmit } from "../hooks/useFormSubmit";
import * as walletApi from "../api/wallet";

export function TransferPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();

  const [receiverId, setReceiverId] = useState(searchParams.get("receiverId") ?? "");
  const receiverName = searchParams.get("receiverName") ?? "";
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState(false);
  const { submitting, error, submit } = useFormSubmit("송금에 실패했습니다.");

  const canSubmit = receiverId.trim().length > 0 && Number(amount) > 0 && !submitting;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !user) return;
    void submit(async () => {
      // Generated once per submit attempt — a retry of the exact same
      // click (e.g. a network blip) should NOT get a new key, but this
      // simple form doesn't retry automatically, so a fresh key per
      // click is fine and still lets the server dedupe true double-clicks
      // (the double-submit guard below prevents most of those client-side
      // anyway; the server-side idempotency key is the real defense).
      const idempotencyKey = crypto.randomUUID();
      await walletApi.transfer(receiverId.trim(), Number(amount), idempotencyKey);
      await refreshUser();
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "60px auto", textAlign: "center" }}>
        <p style={{ fontSize: "2rem" }}>✔</p>
        <h2>송금이 완료되었습니다</h2>
        <Link className="btn btn-primary" to="/mypage">
          마이페이지로
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "24px auto" }}>
      <h1>포인트 보내기</h1>
      <p style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>내 잔액: {Number(user?.balance ?? 0).toLocaleString()}P</p>
      {error && <div className="form-error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="receiverId">받는 사람 ID{receiverName && ` (${receiverName})`}</label>
          <input
            id="receiverId"
            value={receiverId}
            onChange={(e) => setReceiverId(e.target.value)}
            placeholder="받는 사람의 사용자 ID"
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="amount">금액 (P)</label>
          <input id="amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={!canSubmit} style={{ width: "100%" }}>
          {submitting ? "전송 중..." : "보내기"}
        </button>
      </form>
      <p style={{ textAlign: "center", marginTop: 14 }}>
        <button className="btn" onClick={() => navigate(-1)}>
          취소
        </button>
      </p>
    </div>
  );
}
