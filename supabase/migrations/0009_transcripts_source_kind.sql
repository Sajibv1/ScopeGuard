-- Plan §10 Tier 1: a call transcript as a scope source kind.
-- The enum value is added alone: PostgreSQL refuses to reference a new enum
-- value in the same transaction that creates it, and the transcript flag
-- constraints (0010) reference it.

alter type source_kind add value 'transcript';
