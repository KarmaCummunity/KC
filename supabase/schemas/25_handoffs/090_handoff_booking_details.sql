-- Handoffs · handoff_booking_details (the stay behind a housing booking)
--
-- 1:1 with a handoff of a housing post: dates, party, the guest's message and the notes
-- of the decision. Table and access only; the booking RPCs that write it belong to the
-- housing module.

create table public.handoff_booking_details (
  handoff_id          uuid primary key references public.post_handoffs (id) on delete cascade,
  check_in_date       date not null,
  check_out_date      date not null,
  adults              smallint not null check (adults between 1 and 8),
  minors              smallint not null default 0 check (minors between 0 and 7),
  -- The guest's introduction to the host; required with every request.
  message             text not null check (char_length(btrim(message)) between 1 and 500),
  -- The guest confirmed that an adult guardian accompanies the minors.
  minors_guardian_ack boolean not null default false,
  -- The guest cancelled inside the late-cancellation window (FR-HOUSING-018).
  late_cancel         boolean not null default false,
  decision_note       text check (char_length(decision_note) <= 300),
  cancel_note         text check (char_length(cancel_note) <= 300),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint handoff_booking_details_party_chk check (adults + minors <= 8),
  -- At least one night and at most thirty.
  constraint handoff_booking_details_dates_chk
    check (check_out_date > check_in_date and check_out_date - check_in_date <= 30)
);
comment on table public.handoff_booking_details is
  'Stay dates, party and notes of a housing booking. Written only by server code.';

create trigger handoff_booking_details_set_updated_at
  before update on public.handoff_booking_details
  for each row execute function kc_private.set_updated_at();

alter table public.handoff_booking_details enable row level security;
alter table public.handoff_booking_details force row level security;

-- Visible exactly when the handoff is: the subquery runs under the caller's access to
-- post_handoffs, so only the host and the guest match.
create policy handoff_booking_details_select_party on public.handoff_booking_details
  for select to authenticated
  using (exists (select 1 from public.post_handoffs h where h.id = handoff_booking_details.handoff_id));

grant select on public.handoff_booking_details to authenticated;
