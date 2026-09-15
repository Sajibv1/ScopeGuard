-- Requests captured from a voice note, a video, or a screenshot record that
-- as their source, the same way email and chat do. The label is provenance:
-- it says where the words came from, and the capture flow that produces them
-- always shows the machine's transcription or recognition for review before
-- anything is saved as the client message.

alter table change_requests
  drop constraint change_requests_source_label_check;

alter table change_requests
  add constraint change_requests_source_label_check
  check (source_label in ('email', 'chat', 'call_notes', 'voice_note', 'video', 'screenshot', 'other'));
