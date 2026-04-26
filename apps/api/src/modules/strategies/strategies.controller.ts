import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { StrategiesService } from './strategies.service';

const CreateStrategyDto = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  definition: z.record(z.unknown()),
  paramsSchema: z.record(z.unknown()).optional(),
});
type CreateStrategyDto = z.infer<typeof CreateStrategyDto>;

const UpdateStrategyDto = CreateStrategyDto.partial();
type UpdateStrategyDto = z.infer<typeof UpdateStrategyDto>;

@Controller('strategies')
@UseGuards(JwtAuthGuard)
export class StrategiesController {
  constructor(private readonly svc: StrategiesService) {}

  @Get()
  list(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.list(u.sub);
  }

  @Get(':id')
  get(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.get(u.sub, id);
  }

  @Post()
  create(@CurrentUser() u: CurrentUserPayload, @Body(new ZodValidationPipe(CreateStrategyDto)) dto: CreateStrategyDto) {
    return this.svc.create(u.sub, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string, @Body(new ZodValidationPipe(UpdateStrategyDto)) dto: UpdateStrategyDto) {
    return this.svc.update(u.sub, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.remove(u.sub, id);
  }
}
