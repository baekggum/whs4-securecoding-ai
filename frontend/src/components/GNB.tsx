import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function GNB() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <header className="gnb">
      <Link to="/" className="gnb-logo">
        Tiny Secondhand
      </Link>
      <nav className="gnb-links">
        {user ? (
          <>
            <Link className="btn" to="/products/new">
              + 상품 등록
            </Link>
            <Link className="btn" to="/mypage">
              마이페이지
            </Link>
            <button className="btn" onClick={handleLogout}>
              로그아웃
            </button>
          </>
        ) : (
          <>
            <Link className="btn" to="/login">
              로그인
            </Link>
            <Link className="btn btn-primary" to="/signup">
              회원가입
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
