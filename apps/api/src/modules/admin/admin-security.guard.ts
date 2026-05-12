import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Extra security layer on top of RolesGuard for ADMIN routes:
 *   1. If `ADMIN_REQUIRE_MFA` is enabled in AppSetting, refuse the request
 *      when the calling admin doesn't have twoFactorEnabled.
 *   2. If `ADMIN_IP_ALLOWLIST` is set (non-empty array), only allow requests
 *      whose IP matches the list (literal or CIDR /N).
 *
 * Both checks are AppSetting-driven so a SUPER_ADMIN can toggle them without
 * a deploy. If the admin locks themselves out via IP allowlist, fix it via
 * direct DB update of the AppSetting row.
 */
@Injectable()
export class AdminSecurityGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { sub?: string; role?: string } }>();
    const role = req.user?.role;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return true;  // not an admin route, skip
    const userId = req.user?.sub;
    if (!userId) return true;

    const [mfaCfg, ipCfg, user] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { key: 'ADMIN_REQUIRE_MFA' } }),
      this.prisma.appSetting.findUnique({ where: { key: 'ADMIN_IP_ALLOWLIST' } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    ]);

    const mfaRequired = ((mfaCfg?.value ?? { enabled: false }) as { enabled?: boolean }).enabled === true;
    if (mfaRequired && !user?.twoFactorEnabled) {
      throw new ForbiddenException('Admin access requires 2FA. Enable it in Settings → Security.');
    }

    const allowlist = ((ipCfg?.value ?? { ips: [] }) as { ips?: string[] }).ips ?? [];
    if (allowlist.length > 0) {
      const ip = clientIp(req);
      if (!ip || !ipMatchesAny(ip, allowlist)) {
        throw new ForbiddenException(`Admin access from this IP is not allowed (${ip ?? 'unknown'})`);
      }
    }

    return true;
  }
}

function clientIp(req: Request): string | null {
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xff || req.socket.remoteAddress?.replace(/^::ffff:/, '') || null;
}

/** Cheap CIDR match for IPv4. Returns true on exact match or in-range. */
function ipMatchesAny(ip: string, list: string[]): boolean {
  for (const entry of list) {
    if (entry === ip) return true;
    const slash = entry.indexOf('/');
    if (slash === -1) continue;
    const network = entry.slice(0, slash);
    const bits = Number(entry.slice(slash + 1));
    if (!Number.isFinite(bits)) continue;
    if (ip.includes('.') && network.includes('.') && bits >= 0 && bits <= 32) {
      if (cidrMatchV4(ip, network, bits)) return true;
    }
  }
  return false;
}

function cidrMatchV4(ip: string, network: string, bits: number): boolean {
  const ipN = ipv4ToInt(ip);
  const netN = ipv4ToInt(network);
  if (ipN === null || netN === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (netN & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
