import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { env } from '@orca/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  ENGINE_EVENT_CHANNEL,
  type EngineEvent,
} from '../bots/engine-bridge';

interface JwtUser { sub: string; email: string; role: string }

/**
 * Realtime gateway:
 *  - Client authenticates with `auth: { token }` (JWT) on socket.io connect.
 *  - Subscribes to bot-specific rooms: `bot:<botId>` and `user:<userId>`.
 *  - Forwards EngineEvents from Redis pub/sub to the right user/bot rooms.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;
  private readonly log = new Logger('RealtimeGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.redis.subscriber.subscribe(ENGINE_EVENT_CHANNEL);
    this.redis.subscriber.on('message', (channel, raw) => {
      if (channel !== ENGINE_EVENT_CHANNEL) return;
      void this.handleEngineEvent(raw);
    });
    this.log.log(`Subscribed to ${ENGINE_EVENT_CHANNEL}`);
  }

  async onModuleDestroy() {
    try { await this.redis.subscriber.unsubscribe(ENGINE_EVENT_CHANNEL); } catch {}
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string | undefined)
        ?? (client.handshake.headers?.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
      if (!token) { client.disconnect(); return; }
      const payload = await this.jwt.verifyAsync<JwtUser>(token, { secret: env.AUTH_SECRET });
      client.data.user = payload;
      client.join(`user:${payload.sub}`);
      this.log.debug(`Connected: ${client.id} (user ${payload.sub})`);
    } catch (err) {
      this.log.warn(`Auth failed for socket ${client.id}: ${String(err)}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.log.debug(`Disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:bot')
  async subscribeBot(@ConnectedSocket() client: Socket, @MessageBody() botId: string) {
    const user = client.data.user as JwtUser | undefined;
    if (!user || typeof botId !== 'string') return { ok: false };
    const owns = await this.prisma.bot.count({ where: { id: botId, userId: user.sub } });
    if (!owns) return { ok: false, error: 'Bot not found' };
    client.join(`bot:${botId}`);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe:bot')
  unsubscribeBot(@ConnectedSocket() client: Socket, @MessageBody() botId: string) {
    if (typeof botId === 'string') client.leave(`bot:${botId}`);
    return { ok: true };
  }

  private async handleEngineEvent(raw: string): Promise<void> {
    let evt: EngineEvent;
    try { evt = JSON.parse(raw) as EngineEvent; } catch { return; }
    if (!('botId' in evt)) return;
    const bot = await this.prisma.bot.findUnique({
      where: { id: evt.botId },
      select: { userId: true },
    });
    if (!bot) return;
    // Emit to bot-room and user-room
    this.server.to(`bot:${evt.botId}`).emit('bot:event', evt);
    this.server.to(`user:${bot.userId}`).emit('bot:event', evt);
  }
}
