/** A wall-clock limit for one prompt, including tool calls and approval waits. */
export class PromptTimeLimit {
  private deadline?: number;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly expire: () => void) {}

  check(deadline?: string) {
    if (deadline !== undefined) {
      const timestamp = Date.parse(deadline);
      if (!Number.isFinite(timestamp)) throw new Error('Invalid prompt deadline.');
      this.deadline = timestamp;
      this.clear();
      this.schedule();
    }
    const now = Date.now();
    return {
      now: new Date(now).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deadline: this.deadline === undefined ? null : new Date(this.deadline).toISOString(),
      cutoff: this.deadline === undefined ? null : new Date(this.deadline - 60_000).toISOString(),
      secondsRemaining: this.deadline === undefined ? null : Math.max(0, Math.ceil((this.deadline - 60_000 - now) / 1000)),
    };
  }

  private schedule(): void {
    if (this.deadline === undefined) return;
    const cutoff = this.deadline - 60_000;
    const remaining = cutoff - Date.now();
    // Node overflows longer timeouts; re-arm until the actual cutoff is reached.
    this.timer = setTimeout(() => {
      if (cutoff > Date.now()) this.schedule();
      else this.expire();
    }, Math.min(Math.max(0, remaining), 2_147_483_647));
    this.timer.unref();
  }

  clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
