-- Add 'creating_list' status to auto_campaigns

-- Drop the old check constraint and recreate with the new value
alter table public.auto_campaigns
  drop constraint if exists auto_campaigns_status_check;

alter table public.auto_campaigns
  add constraint auto_campaigns_status_check
  check (status in (
    'pending',
    'company_search',
    'creating_list',
    'people_search',
    'enriching',
    'distributing',
    'done',
    'error'
  ));
