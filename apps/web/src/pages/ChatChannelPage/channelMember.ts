export type MentionMember = { readonly id: string; readonly name: string };
export type ChannelMember = MentionMember & { readonly isOnline: boolean };
