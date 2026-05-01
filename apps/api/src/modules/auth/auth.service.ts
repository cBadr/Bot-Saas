import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import type { LoginDto, RegisterDto } from './dto';
import type { JwtPayload } from './jwt.strategy';

const log = createLogger('AUTH');

function parseDuration(spec: string): number {
  const m = /^(\d+)([smhd])$/.exec(spec);
  if (!m) return 0;
  const n = Number(m[1]);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]!]!;
  return n * mult;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly telegram: TelegramService,
  ) {}

  // ─── Password reset ──────────────────────────────────

  /**
   * Issues a password-reset token. Always returns success to avoid
   * leaking which emails exist.
   */
  async forgotPassword(email: string): Promise<{ ok: true; devToken?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, telegramChatId: true },
    });
    if (!user) return { ok: true };

    const rawToken = nanoid(48);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    const resetUrl = `${env.AUTH_URL}/reset-password?token=${rawToken}`;
    log.info('Password reset requested', { userId: user.id });

    // Best-effort delivery via Telegram (we have no SMTP yet)
    if (user.telegramChatId) {
      void this.telegram.send(
        user.telegramChatId,
        `🔐 *Orca password reset*\nClick the link below to reset your password (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this message.`,
      );
    }

    // Dev convenience: return the token in the response so localhost users can test.
    return { ok: true, ...(env.NODE_ENV === 'development' ? { devToken: rawToken } : {}) };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // Revoke all active sessions to force re-login
      this.prisma.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    log.info('Password reset completed', { userId: row.userId });
    return { success: true };
  }

  async register(dto: RegisterDto, ip?: string, userAgent?: string) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');

    let referredById: string | undefined;
    if (dto.referralCode) {
      const refUser = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode },
      });
      if (refUser) referredById = refUser.id;
    }

    const passwordHash = await argon2.hash(dto.password);
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        referralCode: nanoid(10),
        referredById,
        trialEndsAt,
      },
      select: { id: true, email: true, role: true, fullName: true, referralCode: true },
    });
    log.info('User registered', { userId: user.id, email: user.email });
    const tokens = await this.issueTokens(user.id, user.email, user.role, ip, userAgent);
    return { user, ...tokens };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const u = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true, email: true, role: true, status: true, passwordHash: true, fullName: true,
        twoFactorEnabled: true, twoFactorSecret: true,
      },
    });
    if (!u || u.status !== 'ACTIVE') throw new UnauthorizedException('Invalid credentials');
    const valid = await argon2.verify(u.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // 2FA gate
    if (u.twoFactorEnabled && u.twoFactorSecret) {
      if (!dto.twoFactorCode) {
        return {
          requires2FA: true,
          user: { id: u.id, email: u.email },
        } as const;
      }
      const { authenticator } = await import('otplib');
      const ok = authenticator.verify({ token: dto.twoFactorCode, secret: u.twoFactorSecret });
      if (!ok) throw new UnauthorizedException('Invalid 2FA code');
    }

    await this.prisma.user.update({
      where: { id: u.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });
    const tokens = await this.issueTokens(u.id, u.email, u.role, ip, userAgent);
    return {
      user: { id: u.id, email: u.email, role: u.role, fullName: u.fullName },
      ...tokens,
    };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }
    if (session.user.status !== 'ACTIVE') throw new UnauthorizedException('Account not active');

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(session.user.id, session.user.email, session.user.role, ip, userAgent);
  }

  async logout(refreshToken: string) {
    await this.prisma.session.updateMany({
      where: { refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: string,
    ip?: string,
    userAgent?: string,
  ) {
    const payload: JwtPayload = { sub: userId, email, role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: env.JWT_ACCESS_TTL as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
    const refreshToken = nanoid(48);
    const refreshTtlMs = parseDuration(env.JWT_REFRESH_TTL);
    await this.prisma.session.create({
      data: {
        userId,
        refreshToken,
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });
    return { accessToken, refreshToken, accessTtl: env.JWT_ACCESS_TTL };
  }
}
