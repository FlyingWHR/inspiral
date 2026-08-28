/**
 * GETTING OUT OF THE PRODUCT.
 *
 * Everything built so far assumes somebody comes back. Nothing makes them.
 * The return screen is the payload and it is only ever seen by a person who
 * already decided to open the tab -- which is precisely the decision this
 * product cannot currently influence.
 *
 * So: when somebody builds on your work, you hear about it where you actually
 * are.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT ALLOWED TO BECOME
 * ---------------------------------------------------------------------------
 *
 * Every rule the rest of this codebase follows applies harder here, because a
 * notification is the one thing that reaches somebody who did not ask to be
 * reached today.
 *
 *   - NEVER manufacture a reason. A notification fires only when a real person
 *     really built on your real work. No "people are talking about you", no
 *     re-engagement nudges, no digests of things that did not happen.
 *   - BATCH, do not spam. Three extensions in ten minutes is ONE message.
 *   - Quiet by default between sends, per person.
 *   - Opting out is one call and it is permanent until they say otherwise.
 *
 * A product that pings you about nothing teaches you to ignore it, and then the
 * one message that mattered is ignored too.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN CANON
 * ---------------------------------------------------------------------------
 *
 * The EVENT is already in the log -- `piece_extended`, permanent, citable. What
 * lives here is delivery state: pending, sent, failed, retried. That is
 * operational, it is mutable, and it changes for reasons that have nothing to
 * do with what happened in the world. Putting a retry counter in an append-only
 * history would mean a new row every time a mail server was briefly down.
 *
 * Canon says what happened. This says who has been told.
 */

/** Why somebody is being told something. One kind today, deliberately. */
export type NotifyKind = "extended";

/** One pending or delivered notification. Mutable operational state. */
export interface Notification {
  id: number;
  /** Who to tell. */
  fan_id: string;
  kind: NotifyKind;
  /** What happened -- resolves against canon, so nothing here is a claim. */
  piece_id: string;
  event_id: string;
  created_ts: string;
  /** Null until delivered. */
  sent_ts: string | null;
  /** Which channel took it. Null until delivered. */
  channel: string | null;
  /** Last failure, kept so a stuck queue can be diagnosed rather than guessed at. */
  error: string | null;
  attempts: number;
}

/**
 * Where a person wants to be reached, and whether they want to be.
 *
 * `address` is opaque to everything except its own channel: a chat id, a URL,
 * an email. The dispatcher never parses it -- same discipline as an opaque
 * canon location.
 */
export interface NotifyPreference {
  fan_id: string;
  channel: string;
  address: string;
  /** Off means off. The dispatcher checks this before it builds a message. */
  enabled: boolean;
  /** Never send twice inside this window. Batching happens underneath it. */
  quiet_minutes: number;
  updated_ts: string;
}

/**
 * What a channel is handed. Already batched, already resolved against canon,
 * already checked against preferences.
 *
 * A channel's only job is to put this in front of a person. It makes no
 * decisions about whether to -- that judgement lives in one place so it cannot
 * drift between an email path and a chat path.
 */
export interface Delivery {
  fan_id: string;
  address: string;
  /** One line, the subject if the channel has subjects. */
  headline: string;
  /**
   * The body. Carries the sentence when there is one, because that IS the
   * reason to come back -- a notification that says "you have 1 update" is a
   * notification about nothing.
   */
  body: string;
  /** Deep link to the return screen. */
  url: string;
  /** The notification rows this covers, so the dispatcher can mark them. */
  ids: number[];
}

/**
 * A way to reach somebody. Same seam as HostRuntime and ApprovalChannel:
 * one interface, a switch, no vendor SDK above this line.
 */
export interface NotifyChannel {
  /**
   * LOAD-BEARING STRING. It must equal the `channel` on a NotifyPreference:
   * the dispatcher matches them with `channels.find(c => c.name === pref.channel)`.
   *
   * Rename a channel and everybody who chose it silently stops receiving
   * anything, with no error raised anywhere -- the dispatcher just finds no
   * match and moves on. Treat these names as a stored value, because they are
   * one, and migrate the preference rows if one ever has to change.
   */
  readonly name: string;
  /** Throw to fail the delivery. The dispatcher records it and retries later. */
  send(d: Delivery): Promise<void>;
  close?(): Promise<void>;
}

/** Give up after this many failures so one bad address cannot spin forever. */
export const MAX_ATTEMPTS = 5;

/** Default gap between messages to one person. */
export const DEFAULT_QUIET_MINUTES = 30;
