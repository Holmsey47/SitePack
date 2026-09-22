-- Optional fields for an owner-created site.
-- Do not edit the shipped v0 migration. sites_insert_owner already allows the insert.

alter table public.sites
  add column main_contractor text,
  add column what_it_is text;

comment on column public.sites.main_contractor is
  'Optional. Main contractor on this site.';

comment on column public.sites.what_it_is is
  'Optional one-line description, free text. Not a building-type list.';
