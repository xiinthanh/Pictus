/** One undoable edit: the cells it touched and their values before/after. */
export interface Change {
  idx: Int32Array;
  before: Uint8Array;
  after: Uint8Array;
}

/** Undo/redo stacks of cell diffs, bounded by total stored cells. */
export class History {
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  private cells = 0;

  constructor(
    private maxCells = 16_000_000,
    private maxSteps = 300,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** The step `undo()` would revert next, or null. Lets callers tell whose edit it is. */
  get lastUndo(): Change | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  /** Whether `c` can still be undone or redone (it hasn't been trimmed, cleared or replaced). */
  holds(c: Change): boolean {
    return this.undoStack.includes(c) || this.redoStack.includes(c);
  }

  push(c: Change): void {
    if (c.idx.length === 0) return;
    this.undoStack.push(c);
    this.cells += c.idx.length;
    for (const r of this.redoStack) this.cells -= r.idx.length;
    this.redoStack = [];
    while (this.undoStack.length > 1 && (this.cells > this.maxCells || this.undoStack.length > this.maxSteps)) {
      this.cells -= this.undoStack.shift()!.idx.length;
    }
  }

  undo(data: Uint8Array): Change | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    for (let i = 0; i < c.idx.length; i++) data[c.idx[i]] = c.before[i];
    this.redoStack.push(c);
    return c;
  }

  redo(data: Uint8Array): Change | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    for (let i = 0; i < c.idx.length; i++) data[c.idx[i]] = c.after[i];
    this.undoStack.push(c);
    return c;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.cells = 0;
  }
}
