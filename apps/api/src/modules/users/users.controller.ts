import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { UsersService } from './users.service';

const UpdateProfileDto = z.object({
  fullName: z.string().min(2).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  telegramChatId: z.string().optional(),
  telegramUsername: z.string().optional(),
});
type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;

const ChangePasswordDto = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
type ChangePasswordDto = z.infer<typeof ChangePasswordDto>;

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() u: CurrentUserPayload) {
    return this.users.getProfile(u.sub);
  }

  @Patch('me')
  update(@CurrentUser() u: CurrentUserPayload, @Body(new ZodValidationPipe(UpdateProfileDto)) dto: UpdateProfileDto) {
    return this.users.updateProfile(u.sub, dto);
  }

  @Post('me/password')
  changePassword(@CurrentUser() u: CurrentUserPayload, @Body(new ZodValidationPipe(ChangePasswordDto)) dto: ChangePasswordDto) {
    return this.users.changePassword(u.sub, dto.currentPassword, dto.newPassword);
  }

  @Post('me/2fa/setup')
  setup2FA(@CurrentUser() u: CurrentUserPayload) {
    return this.users.setup2FA(u.sub);
  }

  @Post('me/2fa/verify')
  verify2FA(
    @CurrentUser() u: CurrentUserPayload,
    @Body(new ZodValidationPipe(z.object({ code: z.string().length(6) }))) dto: { code: string },
  ) {
    return this.users.verify2FA(u.sub, dto.code);
  }

  @Post('me/2fa/disable')
  disable2FA(
    @CurrentUser() u: CurrentUserPayload,
    @Body(new ZodValidationPipe(z.object({ code: z.string().length(6) }))) dto: { code: string },
  ) {
    return this.users.disable2FA(u.sub, dto.code);
  }
}
