export type UserStatus = "active" | "dormant";
export type ProductStatus = "active" | "blocked";

export interface PublicUser {
  id: string;
  username: string;
  bio: string | null;
  status: UserStatus;
  createdAt: string;
}

export interface SelfUser extends PublicUser {
  updatedAt: string;
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
