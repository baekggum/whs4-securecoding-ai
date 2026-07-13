import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useFormSubmit } from "../hooks/useFormSubmit";
import { ApiError } from "../api/client";

// Login errors are deliberately not the server's raw message: credential
// failures stay vague (계정 존재 여부 노출 방지) and a 403 means the account
// was made dormant by accumulated reports.
function loginErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "로그인에 실패했습니다.";
  return err.status === 403
    ? "장기간 신고 누적으로 휴면 처리된 계정입니다. 관리자에게 문의해주세요."
    : "아이디 또는 비밀번호가 올바르지 않습니다.";
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { submitting, error, submit } = useFormSubmit(loginErrorMessage);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      await login(username, password);
      const from = (location.state as { from?: { pathname: string } } | null)?.from;
      navigate(from?.pathname ?? "/", { replace: true });
    });
  }

  return (
    <div className="auth-layout card">
      <h1>로그인</h1>
      {error && <div className="form-error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="username">아이디</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="password">비밀번호</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
          {submitting ? "로그인 중..." : "로그인"}
        </button>
      </form>
      <p style={{ textAlign: "center", marginTop: 14 }}>
        계정이 없으신가요? <Link to="/signup">회원가입</Link>
      </p>
    </div>
  );
}
