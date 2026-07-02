export type CanWriteChannelInput = {
  actorId: string
  workspaceId: string
  channelId: string
}

export type PermissionPort = {
  /**
   * Workspace / Permission service authority for channel writes.
   *
   * The chat package only orchestrates this decision before persistence; it does not own workspace
   * membership, channel role data, or private channel policy storage.
   */
  canWriteChannel(input: CanWriteChannelInput): Promise<boolean>
}
