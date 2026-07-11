import { Route, Routes } from "react-router-dom";
import { GNB } from "./components/GNB";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import { SignupPage } from "./pages/SignupPage";
import { LoginPage } from "./pages/LoginPage";
import { MainPage } from "./pages/MainPage";
import { ProductNewPage } from "./pages/ProductNewPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { MyPage } from "./pages/MyPage";
import { UserProfilePage } from "./pages/UserProfilePage";
import { ReportPage } from "./pages/ReportPage";
import { ChatRoomPage } from "./pages/ChatRoomPage";
import { TransferPage } from "./pages/TransferPage";
import { AdminPage } from "./pages/AdminPage";

export default function App() {
  return (
    <>
      <GNB />
      <div className="app-shell">
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/users/:id" element={<UserProfilePage />} />
          <Route
            path="/products/new"
            element={
              <ProtectedRoute>
                <ProductNewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mypage"
            element={
              <ProtectedRoute>
                <MyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/report"
            element={
              <ProtectedRoute>
                <ReportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat/:roomId"
            element={
              <ProtectedRoute>
                <ChatRoomPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transfer"
            element={
              <ProtectedRoute>
                <TransferPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
        </Routes>
      </div>
    </>
  );
}
