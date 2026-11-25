-- Схема локального кроссплатформенного ассистента.
-- SQLite 3.37+ (strict), SQLCipher. Время — ISO-8601 UTC.
-- Секреты в БД не хранятся: только secret_ref на OS keychain.

pragma foreign_keys = on;
pragma journal_mode = wal;
pragma busy_timeout = 5000;

-- ---------------------------------------------------------------------------
-- Профиль и настройки
-- ---------------------------------------------------------------------------

create table user_profile (
  id              text primary key,
  display_name    text not null default '',
  locale          text not null default 'ru' check (locale in ('ru','en')),
  assistant_name  text not null default 'Ассистент',
  user_name       text not null default '',
  plan            text not null default 'free' check (plan = 'free'),
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create table settings (
  user_id     text not null references user_profile(id) on delete cascade,
  key         text not null,
  value_json  text not null check (json_valid(value_json)),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, key)
) strict;

create index settings_user_idx on settings (user_id);

-- ---------------------------------------------------------------------------
-- Провайдеры, модели, ключи, голоса
-- ---------------------------------------------------------------------------

create table api_credentials (
  id              text primary key,
  user_id         text not null references user_profile(id) on delete cascade,
  provider_id     text not null,
  label           text not null default '',
  secret_ref      text not null,             -- ссылка на OS keychain, не сам ключ
  status          text not null default 'unknown'
                    check (status in ('unknown','valid','invalid','expired')),
  last_checked_at text,
  quota_hint      text,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index api_credentials_user_idx on api_credentials (user_id, provider_id);

create table provider_configs (
  id            text primary key,
  user_id       text not null references user_profile(id) on delete cascade,
  stage         text not null check (stage in ('stt','llm','tts','live','sidecar')),
  provider_id   text not null,
  base_url      text,
  model_id      text,
  options_json  text not null default '{}' check (json_valid(options_json)),
  is_active     integer not null default 0 check (is_active in (0,1)),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index provider_configs_user_stage_idx on provider_configs (user_id, stage, is_active);

create table voice_presets (
  id            text primary key,
  user_id       text not null references user_profile(id) on delete cascade,
  provider_id   text not null,
  voice_id      text not null,
  display_name  text not null,
  locale        text not null default 'ru',
  is_system     integer not null default 0 check (is_system in (0,1)),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index voice_presets_user_idx on voice_presets (user_id);

-- ---------------------------------------------------------------------------
-- Диалоги
-- ---------------------------------------------------------------------------

create table conversations (
  id          text primary key,
  user_id     text not null references user_profile(id) on delete cascade,
  title       text not null default '',
  model_id    text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at text
) strict;

create index conversations_user_updated_idx on conversations (user_id, updated_at desc);
create index conversations_archived_idx on conversations (user_id, archived_at);

create table messages (
  id               text primary key,
  conversation_id  text not null references conversations(id) on delete cascade,
  parent_id        text references messages(id) on delete set null,
  role             text not null check (role in ('user','assistant','tool','system')),
  text             text not null default '',
  status           text not null default 'done'
                     check (status in ('streaming','done','error','canceled')),
  model_id         text,
  tokens           integer,
  error            text,
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index messages_conversation_idx on messages (conversation_id, created_at);
create index messages_status_idx on messages (status);
create index messages_parent_idx on messages (parent_id);

create table attachments (
  id                text primary key,
  message_id        text not null references messages(id) on delete cascade,
  kind              text not null check (kind in ('file','image','screenshot','audio')),
  file_name         text not null,
  mime              text not null default 'application/octet-stream',
  size              integer not null default 0 check (size >= 0),
  storage_ref       text not null,            -- путь в зашифрованном хранилище
  extracted_text_ref text,
  status            text not null default 'ready'
                      check (status in ('uploading','processing','ready','error')),
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index attachments_message_idx on attachments (message_id);
create index attachments_status_idx on attachments (status);

-- Полнотекстовый поиск по сообщениям (FTS5)
create virtual table messages_fts using fts5(
  text,
  content='messages',
  content_rowid='rowid'
);

create trigger messages_fts_ai after insert on messages begin
  insert into messages_fts (rowid, text) values (new.rowid, new.text);
end;

create trigger messages_fts_ad after delete on messages begin
  insert into messages_fts (messages_fts, rowid, text)
  values ('delete', old.rowid, old.text);
end;

create trigger messages_fts_au after update of text on messages begin
  insert into messages_fts (messages_fts, rowid, text)
  values ('delete', old.rowid, old.text);
  insert into messages_fts (rowid, text) values (new.rowid, new.text);
end;

-- ---------------------------------------------------------------------------
-- Память, напоминания, задачи, фоновые исследования
-- ---------------------------------------------------------------------------

create table memory_entries (
  id                text primary key,
  user_id           text not null references user_profile(id) on delete cascade,
  kind              text not null check (kind in ('fact','summary','preference')),
  text              text not null,
  source_message_id text references messages(id) on delete set null,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at      text
) strict;

create index memory_entries_user_idx on memory_entries (user_id, created_at desc);
create index memory_entries_kind_idx on memory_entries (user_id, kind);

create virtual table memory_fts using fts5(
  text,
  content='memory_entries',
  content_rowid='rowid'
);

create trigger memory_fts_ai after insert on memory_entries begin
  insert into memory_fts (rowid, text) values (new.rowid, new.text);
end;

create trigger memory_fts_ad after delete on memory_entries begin
  insert into memory_fts (memory_fts, rowid, text)
  values ('delete', old.rowid, old.text);
end;

create trigger memory_fts_au after update of text on memory_entries begin
  insert into memory_fts (memory_fts, rowid, text)
  values ('delete', old.rowid, old.text);
  insert into memory_fts (rowid, text) values (new.rowid, new.text);
end;

create table reminders (
  id           text primary key,
  user_id      text not null references user_profile(id) on delete cascade,
  title        text not null,
  due_at       text not null,
  repeat_rule  text,
  status       text not null default 'pending'
                 check (status in ('pending','done','dismissed')),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index reminders_due_idx on reminders (status, due_at);
create index reminders_user_idx on reminders (user_id, status, due_at);

create table tasks (
  id            text primary key,
  user_id       text not null references user_profile(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  status        text not null default 'todo'
                  check (status in ('todo','doing','done','failed')),
  priority      text not null default 'normal'
                  check (priority in ('low','normal','high','urgent')),
  due_at        text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  text
) strict;

create index tasks_user_status_idx on tasks (user_id, status, due_at);
create index tasks_due_idx on tasks (status, due_at);

create table background_tasks (
  id           text primary key,
  user_id      text not null references user_profile(id) on delete cascade,
  kind         text not null check (kind in ('research','brief','monitor')),
  prompt       text not null,
  status       text not null default 'queued'
                 check (status in ('queued','running','done','failed','canceled')),
  progress     integer not null default 0 check (progress between 0 and 100),
  error        text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at   text,
  finished_at  text
) strict;

create index background_tasks_queue_idx on background_tasks (status, created_at);
create index background_tasks_user_idx on background_tasks (user_id, created_at desc);

create table content_reports (
  id                   text primary key,
  user_id              text not null references user_profile(id) on delete cascade,
  background_task_id   text references background_tasks(id) on delete set null,
  title                text not null default '',
  body_md              text not null default '',
  sources_json         text not null default '[]' check (json_valid(sources_json)),
  created_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index content_reports_user_idx on content_reports (user_id, created_at desc);
create index content_reports_task_idx on content_reports (background_task_id);

-- ---------------------------------------------------------------------------
-- Проект, файлы, терминал
-- ---------------------------------------------------------------------------

create table workspaces (
  id          text primary key,
  user_id     text not null references user_profile(id) on delete cascade,
  path        text not null,
  open_mode   text not null default 'internal'
                check (open_mode in ('internal','system')),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create unique index workspaces_user_path_idx on workspaces (user_id, path);

create table project_files (
  id              text primary key,
  workspace_id    text not null references workspaces(id) on delete cascade,
  relative_path   text not null,
  kind            text not null default 'file' check (kind in ('file','dir')),
  size            integer not null default 0 check (size >= 0),
  mtime           text,
  is_text         integer not null default 1 check (is_text in (0,1)),
  last_opened_at  text,
  unique (workspace_id, relative_path)
) strict;

create index project_files_workspace_idx on project_files (workspace_id, relative_path);

create table terminal_sessions (
  id            text primary key,
  workspace_id  text references workspaces(id) on delete set null,
  cwd           text not null,
  shell         text not null,
  started_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at      text,
  exit_code     integer
) strict;

create index terminal_sessions_workspace_idx on terminal_sessions (workspace_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Действия, разрешения, аудит
-- ---------------------------------------------------------------------------

create table actions (
  id                text primary key,
  user_id           text not null references user_profile(id) on delete cascade,
  conversation_id   text references conversations(id) on delete set null,
  message_id        text references messages(id) on delete set null,
  tool_name         text not null,
  args_json         text not null default '{}' check (json_valid(args_json)),
  risk_level        text not null default 'low'
                      check (risk_level in ('low','medium','high','critical')),
  permission_scope  text,
  status            text not null default 'proposed'
                      check (status in ('proposed','approved','denied','running',
                                        'done','failed','canceled')),
  result_json       text check (result_json is null or json_valid(result_json)),
  error             text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at        text,
  finished_at       text
) strict;

create index actions_user_created_idx on actions (user_id, created_at desc);
create index actions_conversation_idx on actions (conversation_id);
create index actions_message_idx on actions (message_id);
create index actions_status_idx on actions (status);

create table action_logs (
  id          text primary key,
  action_id   text not null references actions(id) on delete cascade,
  user_id     text not null references user_profile(id) on delete cascade,
  summary     text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index action_logs_user_idx on action_logs (user_id, created_at desc);
create index action_logs_action_idx on action_logs (action_id);

create table permissions (
  id          text primary key,
  user_id     text not null references user_profile(id) on delete cascade,
  scope       text not null check (scope in ('observe_screen','find_elements',
                                             'move_mouse','click','type')),
  mode        text not null default 'ask'
                check (mode in ('ask','approve','full','denied')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, scope)
) strict;

create index permissions_user_idx on permissions (user_id);

create table audit_events (
  id           text primary key,
  user_id      text references user_profile(id) on delete cascade,
  kind         text not null,
  payload_json text not null default '{}' check (json_valid(payload_json)),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) strict;

create index audit_events_user_idx on audit_events (user_id, created_at desc);
create index audit_events_kind_idx on audit_events (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Плагины
-- ---------------------------------------------------------------------------

create table plugins (
  id                text primary key,
  name              text not null,
  version           text not null,
  description       text not null default '',
  entrypoint        text not null,
  manifest_json     text not null default '{}' check (json_valid(manifest_json)),
  enabled           integer not null default 0 check (enabled in (0,1)),
  broken_reason     text,
  permissions_json  text not null default '[]' check (json_valid(permissions_json)),
  installed_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (name)
) strict;

create index plugins_enabled_idx on plugins (enabled);

create table plugin_configs (
  id           text primary key,
  plugin_id    text not null references plugins(id) on delete cascade,
  user_id      text not null references user_profile(id) on delete cascade,
  config_json  text not null default '{}' check (json_valid(config_json)),
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (plugin_id, user_id)
) strict;

create index plugin_configs_user_idx on plugin_configs (user_id);

create table plugin_runs (
  id           text primary key,
  plugin_id    text not null references plugins(id) on delete cascade,
  action       text not null,
  status       text not null default 'running'
                 check (status in ('running','done','failed','timeout')),
  result_json  text check (result_json is null or json_valid(result_json)),
  error        text,
  started_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at  text
) strict;

create index plugin_runs_plugin_idx on plugin_runs (plugin_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Безопасность, сопряжение, обновления
-- ---------------------------------------------------------------------------

create table device_pairings (
  id            text primary key,
  user_id       text not null references user_profile(id) on delete cascade,
  device_name   text not null,
  token_hash    text not null,
  expires_at    text not null,
  last_seen_at  text,
  https_enabled integer not null default 0 check (https_enabled in (0,1)),
  revoked_at    text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (token_hash)
) strict;

create index device_pairings_user_idx on device_pairings (user_id, revoked_at);

create table lock_credentials (
  id               text primary key,
  user_id          text not null references user_profile(id) on delete cascade,
  kind             text not null check (kind in ('pin','password','face')),
  verifier_ref     text not null,            -- keychain/argon2-verifier, не сам секрет
  failed_attempts  integer not null default 0 check (failed_attempts >= 0),
  locked_until     text,
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, kind)
) strict;

create table update_state (
  id                 text primary key,
  channel            text not null default 'stable' check (channel in ('stable','beta')),
  current_version    text not null,
  available_version  text,
  last_checked_at    text,
  download_status    text not null default 'idle'
                       check (download_status in ('idle','downloading','ready','failed')),
  install_status     text not null default 'idle'
                       check (install_status in ('idle','installing','done','failed')),
  updated_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (channel)
) strict;

-- ---------------------------------------------------------------------------
-- updated_at: обновляется data-layer; триггеры для основных таблиц
-- ---------------------------------------------------------------------------

create trigger user_profile_touch after update on user_profile begin
  update user_profile set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id;
end;

create trigger conversations_touch after update on conversations begin
  update conversations set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id;
end;

create trigger workspaces_touch after update on workspaces begin
  update workspaces set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id;
end;

create trigger tasks_touch after update on tasks begin
  update tasks set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = new.id;
end;
