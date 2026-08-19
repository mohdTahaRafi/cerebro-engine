import { request } from '../client';
import type {
  SessionResponse, SignupRequest, LoginRequest, AuthCapabilities,
  ForgotPasswordRequest, ForgotPasswordResponse, VerifyOtpRequest, VerifyOtpResponse,
  ResetPasswordRequest,
} from '../contracts';

export const auth = {
  session: () => request<SessionResponse>('/auth/session'),
  capabilities: () => request<AuthCapabilities>('/auth/capabilities'),
  signup: (body: SignupRequest) => request<SessionResponse>('/auth/signup', { method: 'POST', json: body }),
  login: (body: LoginRequest) => request<SessionResponse>('/auth/login', { method: 'POST', json: body }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  forgotPassword: (body: ForgotPasswordRequest) =>
    request<ForgotPasswordResponse>('/auth/forgot-password', { method: 'POST', json: body }),
  verifyOtp: (body: VerifyOtpRequest) =>
    request<VerifyOtpResponse>('/auth/verify-otp', { method: 'POST', json: body }),
  resetPassword: (body: ResetPasswordRequest) =>
    request<void>('/auth/reset-password', { method: 'POST', json: body }),
};
