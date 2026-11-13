-- 0345_pgtap_extension | KC#899 — enable pgTAP for feed performance tests (local/CI).

create extension if not exists pgtap with schema extensions;
