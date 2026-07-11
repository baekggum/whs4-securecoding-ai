export type UserStatus = "active" | "dormant";
export type ProductStatus = "active" | "blocked";
export type UserRole = "user" | "admin";

export interface PublicUser {
  id: string;
  username: string;
  bio: string | null;
  status: UserStatus;
  createdAt: string;
}

export interface SelfUser extends PublicUser {
  updatedAt: string;
  role: UserRole;
  balance: string;
}

export interface Transfer {
  id: string;
  senderId: string;
  receiverId: string;
  amount: string;
  senderBalanceAfter: string;
  receiverBalanceAfter: string;
  createdAt: string;
}

export interface AdminUserSummary {
  id: string;
  username: string;
  status: UserStatus;
  role: UserRole;
  reportCount: number;
  createdAt: string;
}

export interface AdminReport {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  reporter?: { id: string; username: string };
  target: { type: "user" | "product"; id: string; label: string } | null;
}

export interface ProductListItem {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  sellerId: string;
  status: ProductStatus;
  reportCount: number;
  imagePath: string | null;
  createdAt: string;
  updatedAt: string;
  seller?: { id: string; username: string; status: UserStatus };
}

export interface ChatRoomSummary {
  id: string;
  type: "global" | "direct";
  otherUser: PublicUser | null;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender?: { id: string; username: string; status: UserStatus };
  senderUsername?: string;
  senderStatus?: UserStatus;
}

export type ReportTargetType = "user" | "product";
