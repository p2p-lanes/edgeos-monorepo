-- ============================================================================
-- PostgreSQL Database Optimization Script for EdgeOS
-- ============================================================================
-- Run this script as a superuser after applying the Alembic migration.
-- These are server-level configurations that improve performance and stability.
-- ============================================================================

-- ============================================================================
-- 1. Connection Timeout Settings
-- ============================================================================

-- Terminate connections idle in transaction after 30 seconds
-- Prevents connections holding locks indefinitely
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';

-- Terminate completely idle connections after 10 minutes
-- Reclaims unused connection slots
ALTER SYSTEM SET idle_session_timeout = '10min';

-- Set default statement timeout to 60 seconds
-- Prevents runaway queries from consuming resources
ALTER SYSTEM SET statement_timeout = '60s';

-- ============================================================================
-- 2. Connection Limits (adjust based on your server RAM)
-- ============================================================================
-- Formula: max_connections = (RAM in MB / 5MB) - 10 reserved
-- For 4GB RAM: (4096 / 5) - 10 = ~800 theoretical, but 100-200 is practical

-- Uncomment and adjust for your environment:
-- ALTER SYSTEM SET max_connections = 100;

-- ============================================================================
-- 3. Memory Settings (adjust based on your server RAM)
-- ============================================================================
-- work_mem * max_connections should not exceed 25% of RAM

-- Uncomment and adjust for your environment:
-- ALTER SYSTEM SET work_mem = '8MB';  -- 8MB * 100 = 800MB max
-- ALTER SYSTEM SET shared_buffers = '1GB';  -- 25% of RAM for 4GB server
-- ALTER SYSTEM SET effective_cache_size = '3GB';  -- 75% of RAM

-- ============================================================================
-- 4. Autovacuum Tuning for High-Churn Tables
-- ============================================================================

-- More aggressive autovacuum for applications table (high write volume)
ALTER TABLE applications SET (
    autovacuum_vacuum_scale_factor = 0.05,     -- Vacuum at 5% dead tuples (default 20%)
    autovacuum_analyze_scale_factor = 0.02     -- Analyze at 2% changes (default 10%)
);

-- More aggressive autovacuum for payments table
ALTER TABLE payments SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

-- More aggressive autovacuum for attendees table
ALTER TABLE attendees SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

-- ============================================================================
-- 5. Enable Query Statistics Extension
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================================
-- 6. Reload Configuration
-- ============================================================================

SELECT pg_reload_conf();

-- ============================================================================
-- 7. Verify Settings
-- ============================================================================

-- Show current timeout settings
SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
    'idle_in_transaction_session_timeout',
    'idle_session_timeout',
    'statement_timeout',
    'max_connections',
    'work_mem',
    'shared_buffers'
);

-- ============================================================================
-- MONITORING QUERIES (Run periodically to check health)
-- ============================================================================

-- Check connection usage
-- SELECT count(*), state FROM pg_stat_activity GROUP BY state;

-- Check for long-running queries
-- SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
-- FROM pg_stat_activity
-- WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';

-- Check table statistics freshness
-- SELECT relname, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, n_dead_tup
-- FROM pg_stat_user_tables
-- ORDER BY n_dead_tup DESC;

-- Find unused indexes
-- SELECT schemaname, tablename, indexname, idx_scan
-- FROM pg_stat_user_indexes
-- WHERE idx_scan = 0 AND indexname NOT LIKE 'pg_%'
-- ORDER BY pg_relation_size(indexrelid) DESC;

-- Top queries by total time (requires pg_stat_statements)
-- SELECT calls, round(total_exec_time::numeric, 2) as total_time_ms,
--        round(mean_exec_time::numeric, 2) as mean_time_ms, query
-- FROM pg_stat_statements
-- ORDER BY total_exec_time DESC
-- LIMIT 20;
