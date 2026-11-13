-- Purge legacy soft-hidden donation links (FR-DONATE-009).
-- Remove path now uses DELETE instead of setting hidden_at/hidden_by.

delete from public.donation_links
where hidden_at is not null;
