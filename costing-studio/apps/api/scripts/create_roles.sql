\set ON_ERROR_STOP on

SELECT format('CREATE ROLE costing_migrator LOGIN BYPASSRLS PASSWORD %L', :'mig_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'costing_migrator')
\gexec
SELECT format('ALTER ROLE costing_migrator PASSWORD %L', :'mig_pw')
\gexec

SELECT format('CREATE ROLE costing_app LOGIN NOBYPASSRLS PASSWORD %L', :'app_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'costing_app')
\gexec
SELECT format('ALTER ROLE costing_app PASSWORD %L', :'app_pw')
\gexec

SELECT format('CREATE ROLE costing_worker LOGIN NOBYPASSRLS PASSWORD %L', :'worker_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'costing_worker')
\gexec
SELECT format('ALTER ROLE costing_worker PASSWORD %L', :'worker_pw')
\gexec

GRANT ALL ON DATABASE costing TO costing_migrator;
GRANT ALL ON SCHEMA public TO costing_migrator;
GRANT CONNECT ON DATABASE costing TO costing_app, costing_worker;
GRANT USAGE ON SCHEMA public TO costing_app, costing_worker;
