-- =============================================================================
-- Server-side scheduling with pg_cron (runs inside Postgres, every minute).
-- Does not depend on a browser or the admin dashboard being open.
-- Enable first: Dashboard → Database → Extensions → pg_cron (or the line below).
-- =============================================================================
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'process-scheduled-content';

select cron.schedule(
  'process-scheduled-content',
  '* * * * *',
  $$ select private.process_scheduled_content(); $$
);

-- Monthly analytics retention (keep 13 months of anonymous events).
select cron.unschedule(jobid) from cron.job where jobname = 'analytics-retention';
select cron.schedule(
  'analytics-retention',
  '15 3 1 * *',
  $$ delete from public.analytics_events where created_at < now() - interval '13 months'; $$
);

-- Inspect runs:  select * from cron.job_run_details order by start_time desc limit 20;
