export type ReadCursorSnapshot = {
  userId: string
  streamId: string
  lastReadSequence: number
  updatedAt: number
}

export class ReadCursor {
  private readonly snapshot: ReadCursorSnapshot

  constructor(snapshot: ReadCursorSnapshot) {
    if (snapshot.lastReadSequence < 0) {
      throw new Error('read cursor lastReadSequence cannot be negative')
    }

    this.snapshot = snapshot
  }

  advance(requestedSequence: number, now: number): ReadCursorAdvanceResult {
    if (requestedSequence <= this.snapshot.lastReadSequence) {
      return {
        advanced: false,
        cursor: this,
      }
    }

    return {
      advanced: true,
      cursor: new ReadCursor({
        ...this.snapshot,
        lastReadSequence: requestedSequence,
        updatedAt: now,
      }),
    }
  }

  toSnapshot(): ReadCursorSnapshot {
    return { ...this.snapshot }
  }
}

export type ReadCursorAdvanceResult = {
  advanced: boolean
  cursor: ReadCursor
}
