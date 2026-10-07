-- pg_cron is needed here and by the cron jobs in 0008 and 0009, so enable it first.
create extension if not exists pg_cron;

-- Runs every hour (at :15), not once a day, because each household's day rolls over at its own local midnight.
select cron.schedule('hourly-misses', '15 * * * *', $$select run_daily_misses()$$);
