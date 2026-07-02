import type { SyncChatStreamCommand, SyncChatStreamResult } from '../contract'
import type { ChatMessageRepositoryPort } from '../ports'

export type SyncChatStreamUseCase = {
  /**
   * Returns persisted messages after the caller-held sequence for the same stream.
   */
  execute(input: SyncChatStreamCommand): Promise<SyncChatStreamResult>
}

export type SyncChatStreamUseCaseDeps = {
  messageRepository: ChatMessageRepositoryPort
}

export function createSyncChatStreamUseCase(
  deps: SyncChatStreamUseCaseDeps,
): SyncChatStreamUseCase {
  return {
    async execute(input: SyncChatStreamCommand): Promise<SyncChatStreamResult> {
      const messages = await deps.messageRepository.listMessagesAfter({
        streamId: input.streamId,
        afterSequence: input.afterSequence,
        limit: input.limit,
      })

      return {
        type: 'chat.stream.synced',
        streamId: input.streamId,
        afterSequence: input.afterSequence,
        messages,
      }
    },
  }
}
