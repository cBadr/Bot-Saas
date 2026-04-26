import { z } from 'zod';

export const RegisterDto = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(2).max(100).optional(),
  referralCode: z.string().optional(),
});
export type RegisterDto = z.infer<typeof RegisterDto>;

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  twoFactorCode: z.string().length(6).optional(),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const RefreshDto = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshDto = z.infer<typeof RefreshDto>;

export const ForgotPasswordDto = z.object({
  email: z.string().email(),
});
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordDto>;

export const ResetPasswordDto = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordDto>;
