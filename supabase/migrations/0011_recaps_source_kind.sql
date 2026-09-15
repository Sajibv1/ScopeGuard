-- Recap-then-confirm (plan §10, Tier 2), part 1: the source kind alone.
--
-- A "recap" document is the user's OWN rough notes about a call — memory,
-- not an agreement. Like 0009_transcripts_source_kind.sql, the enum value
-- ships by itself: Postgres refuses CHECK constraints that reference a new
-- enum value in the same transaction, so 0012 adds the columns and
-- constraints that use it.

alter type source_kind add value 'recap';
