import type { GatewaySessionId, UserId } from "@wake-surfer/realtime-chat-contracts";
import type { GatewaySession } from "./gateway-session";

export class InMemoryGatewaySessionRegistry {
  private readonly sessions = new Map<GatewaySessionId, GatewaySession>();
  private readonly sessionsByUser = new Map<UserId, Set<GatewaySessionId>>();

  register(session: GatewaySession): void {
    this.sessions.set(session.sessionId, session);

    const existing = this.sessionsByUser.get(session.userId) ?? new Set();
    existing.add(session.sessionId);
    this.sessionsByUser.set(session.userId, existing);
  }

  unregister(sessionId: GatewaySessionId): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    const userSessions = this.sessionsByUser.get(session.userId);
    userSessions?.delete(sessionId);

    if (userSessions && userSessions.size === 0) {
      this.sessionsByUser.delete(session.userId);
    }
  }

  findByUserIds(userIds: UserId[]): GatewaySession[] {
    const sessions: GatewaySession[] = [];

    for (const userId of userIds) {
      const sessionIds = this.sessionsByUser.get(userId);

      if (!sessionIds) {
        continue;
      }

      for (const sessionId of sessionIds) {
        const session = this.sessions.get(sessionId);

        if (session) {
          sessions.push(session);
        }
      }
    }

    return sessions;
  }
}
