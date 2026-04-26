import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── 2FA ───
  async setup2FA(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    if (u.twoFactorEnabled) throw new BadRequestException('2FA already enabled');
    const secret = authenticator.generateSecret();
    // Store secret but don't enable yet — user must verify a code first.
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    const otpauthUrl = authenticator.keyuri(u.email, 'Orca', secret);
    return { secret, otpauthUrl };
  }

  async verify2FA(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.twoFactorSecret) throw new BadRequestException('2FA not initialized');
    const ok = authenticator.verify({ token: code, secret: u.twoFactorSecret });
    if (!ok) throw new BadRequestException('Invalid code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    return { success: true };
  }

  async disable2FA(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.twoFactorEnabled || !u.twoFactorSecret) {
      throw new BadRequestException('2FA not enabled');
    }
    const ok = authenticator.verify({ token: code, secret: u.twoFactorSecret });
    if (!ok) throw new BadRequestException('Invalid code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    return { success: true };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, fullName: true, avatarUrl: true,
        role: true, status: true, twoFactorEnabled: true,
        telegramChatId: true, telegramUsername: true,
        referralCode: true, createdAt: true, lastLoginAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, data: { fullName?: string; avatarUrl?: string; telegramChatId?: string; telegramUsername?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, fullName: true, avatarUrl: true, telegramChatId: true, telegramUsername: true },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    const ok = await argon2.verify(u.passwordHash, currentPassword);
    if (!ok) throw new NotFoundException('Current password incorrect');
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }
}
