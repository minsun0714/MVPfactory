import type { MeetingStatement, MeetingReaction } from "@/contracts";
import type { SceneSnapshot } from "@/components/office/scene/model";
import { statementDuration } from "@/components/office/scene/motion";

/** Bounded presentation queue; never changes server meeting/run state. */
export class Conversation {
  current: MeetingStatement | null = null;
  reaction: MeetingReaction | null = null;
  remaining = 0;
  reactionRemaining = 0;
  private queue: MeetingStatement[] = [];
  private reactions: MeetingReaction[] = [];
  private seen = -1;
  private seenReaction = -1;
  private key: string | null = null;
  private restoreLatest = false;
  sync(snapshot: SceneSnapshot, restore: boolean) {
    const key = `${snapshot.projectId}:${snapshot.meetingId}`;
    if (key !== this.key) {
      this.key = key;
      this.current = null;
      this.reaction = null;
      this.queue = [];
      this.reactions = [];
      this.remaining = this.reactionRemaining = 0;
      this.seen = this.seenReaction = -1;
      this.restoreLatest = restore;
    }
    if (!snapshot.participants.length) {
      this.current = null;
      this.reaction = null;
      this.queue = [];
      this.reactions = [];
      this.remaining = this.reactionRemaining = 0;
      return;
    }
    if (this.current && !snapshot.participants.includes(this.current.role)) {
      this.current = null;
      this.remaining = 0;
    }
    const restoring = this.restoreLatest;
    const incoming = snapshot.statements.filter(
      (s) => s.sequence > this.seen && snapshot.participants.includes(s.role),
    );
    if (incoming.length) {
      this.seen = incoming[incoming.length - 1].sequence;
      if (this.restoreLatest) {
        this.current = incoming[incoming.length - 1];
        this.restoreLatest = false;
      } else this.queue = [...this.queue, ...incoming].slice(-3);
    }
    const reactions = snapshot.reactions.filter(
      (r) =>
        r.sequence > this.seenReaction &&
        snapshot.participants.includes(r.role),
    );
    if (reactions.length) {
      this.seenReaction = Math.max(...reactions.map((r) => r.sequence));
      if (!restore && !restoring)
        this.reactions = [...this.reactions, ...reactions].slice(-4);
    }
    if (snapshot.status === "WAITING_CEO" || snapshot.status === "FAILED") {
      this.current = snapshot.statements.at(-1) ?? this.current;
      this.queue = [];
      this.reactions = [];
      this.remaining = this.reactionRemaining = 0;
      this.reaction = null;
    }
  }
  tick(ms: number, seated: boolean, paused: boolean, reduced: boolean) {
    if (paused || !seated) return;
    this.remaining = Math.max(0, this.remaining - ms);
    this.reactionRemaining = Math.max(0, this.reactionRemaining - ms);
    if (!this.reactionRemaining) this.reaction = null;
    if (!this.remaining && this.queue.length) {
      this.current = (reduced ? this.queue.at(-1) : this.queue.shift()) ?? null;
      if (reduced) this.queue = [];
      this.remaining = reduced
        ? 0
        : statementDuration(this.current?.summary ?? "");
    }
    const nextReaction = this.reactions[0];
    if (
      !this.reactionRemaining &&
      nextReaction &&
      (!this.current ||
        nextReaction.sequence <= this.current.sequence ||
        this.remaining === 0)
    ) {
      this.reaction = this.reactions.shift() ?? null;
      this.reactionRemaining = reduced ? 0 : 720;
      if (reduced) this.reaction = null;
    }
  }
  get active() {
    return (
      this.remaining > 0 ||
      this.reactionRemaining > 0 ||
      this.queue.length > 0 ||
      this.reactions.length > 0
    );
  }
}
