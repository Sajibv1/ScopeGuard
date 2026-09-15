/**
 * Domain errors shared by server and client code.
 *
 * Deliberately dependency-free so client components can import them without
 * dragging in the server-only Supabase modules.
 */

/**
 * Thrown when a record does not exist, OR exists but belongs to someone else.
 *
 * Both cases produce the SAME error on purpose: distinguishing them would let
 * someone probe for the existence of other users' project ids.
 */
export class NotFoundError extends Error {
  constructor(what = "record") {
    super(`That ${what} could not be found.`);
    this.name = "NotFoundError";
  }
}
