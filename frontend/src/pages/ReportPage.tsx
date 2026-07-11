import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as reportApi from "../api/reports";
import { ApiError } from "../api/client";
import type { ReportTargetType } from "../types";

const REASON_CATEGORIES = ["허위매물", "사기 의심", "부적절한 게시물", "욕설 / 비방", "기타"];

export function ReportPage() {
  const [searchParams] = useSearchParams();
  const targetType = (searchParams.get("targetType") as ReportTargetType | null) ?? "product";
  const targetId = searchParams.get("targetId") ?? "";
  const targetName = searchParams.get("targetName") ?? "";

  const [category, setCategory] = useState(REASON_CATEGORIES[0]);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit = detail.trim().length >= 10 && !!targetId;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (!confirm("허위 신고 시 제재될 수 있습니다. 신고를 접수하시겠습니까?")) return;

    setSubmitting(true);
    setError(null);
    try {
      const reason = `[${category}] ${detail.trim()}`;
      await reportApi.createReport(targetType, targetId, reason);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "신고 접수에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!targetId) {
    return <div className="empty-state">신고 대상 정보가 없습니다.</div>;
  }

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "60px auto", textAlign: "center" }}>
        <p style={{ fontSize: "2rem" }}>✔</p>
        <h2>신고가 접수되었습니다</h2>
        <p>검토 후 처리 결과를 안내드립니다.</p>
        <Link className="btn btn-primary" to="/">
          확인
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 480, margin: "24px auto" }}>
      <h1>신고하기</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        신고 대상: {targetName || targetId} ({targetType === "product" ? "상품 신고" : "유저 신고"})
      </div>
      {error && <div className="form-error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label>신고 사유를 선택해주세요</label>
          {REASON_CATEGORIES.map((c) => (
            <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
              <input type="radio" name="category" checked={category === c} onChange={() => setCategory(c)} />
              {c}
            </label>
          ))}
        </div>
        <div className="form-field">
          <label htmlFor="detail">상세 사유 (필수, 최소 10자)</label>
          <textarea
            id="detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={4}
            maxLength={1000}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={!canSubmit || submitting} style={{ width: "100%" }}>
          {submitting ? "접수 중..." : "신고 접수"}
        </button>
      </form>
    </div>
  );
}
