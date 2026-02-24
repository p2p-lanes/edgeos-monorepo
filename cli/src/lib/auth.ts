import { apiPost, apiGet } from "./api.ts";

export interface LoginResponse {
  message: string;
  email: string;
  expires_in_minutes: number;
}

export interface AuthenticateResponse {
  access_token: string;
  token_type: string;
}

export interface UserInfo {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
  [key: string]: unknown;
}

export async function login(email: string): Promise<LoginResponse> {
  return apiPost("/api/v1/auth/user/login", { email });
}

export async function authenticate(
  email: string,
  code: string
): Promise<AuthenticateResponse> {
  return apiPost("/api/v1/auth/user/authenticate", { email, code });
}

export async function getCurrentUser(): Promise<UserInfo> {
  return apiGet("/api/v1/users/me");
}
