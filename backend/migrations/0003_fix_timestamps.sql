-- Исправляет невалидные метки времени, записанные старой версией db.now_iso():
-- Python-формат %f давал 'ЧЧ:ММ:микросекунды' вместо 'ЧЧ:ММ:СС.мс'.
-- Формат: 2026-11-24T16:24:337490Z -> 2026-11-24T16:24:33.7490Z.
-- Повторяем для всех текстовых колонок времени, которые мог записать срез.

update messages set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update conversations set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update conversations set updated_at = substr(updated_at,1,17) || substr(updated_at,18,2) || '.' || substr(updated_at,20,4) || 'Z' where updated_at glob '????-??-??T??:??:??????Z';
update user_profile set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update user_profile set updated_at = substr(updated_at,1,17) || substr(updated_at,18,2) || '.' || substr(updated_at,20,4) || 'Z' where updated_at glob '????-??-??T??:??:??????Z';
update settings set updated_at = substr(updated_at,1,17) || substr(updated_at,18,2) || '.' || substr(updated_at,20,4) || 'Z' where updated_at glob '????-??-??T??:??:??????Z';
update api_credentials set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update api_credentials set updated_at = substr(updated_at,1,17) || substr(updated_at,18,2) || '.' || substr(updated_at,20,4) || 'Z' where updated_at glob '????-??-??T??:??:??????Z';
update provider_configs set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update provider_configs set updated_at = substr(updated_at,1,17) || substr(updated_at,18,2) || '.' || substr(updated_at,20,4) || 'Z' where updated_at glob '????-??-??T??:??:??????Z';
update memory_entries set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update reminders set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update tasks set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update workspaces set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update actions set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update action_logs set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update audit_events set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update plugins set installed_at = substr(installed_at,1,17) || substr(installed_at,18,2) || '.' || substr(installed_at,20,4) || 'Z' where installed_at glob '????-??-??T??:??:??????Z';
update plugin_configs set updated_at = substr(updated_at,1,17) || substr(updated_at,18,2) || '.' || substr(updated_at,20,4) || 'Z' where updated_at glob '????-??-??T??:??:??????Z';
update plugin_runs set started_at = substr(started_at,1,17) || substr(started_at,18,2) || '.' || substr(started_at,20,4) || 'Z' where started_at glob '????-??-??T??:??:??????Z';
update device_pairings set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update lock_credentials set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
update update_state set updated_at = substr(updated_at,1,17) || substr(updated_at,18,2) || '.' || substr(updated_at,20,4) || 'Z' where updated_at glob '????-??-??T??:??:??????Z';
update content_reports set created_at = substr(created_at,1,17) || substr(created_at,18,2) || '.' || substr(created_at,20,4) || 'Z' where created_at glob '????-??-??T??:??:??????Z';
