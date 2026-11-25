-- Расширяет область разрешений: системные действия, файлы, терминал и поиск.
-- SQLite не умеет менять CHECK, поэтому таблица пересобирается целиком.

alter table permissions rename to permissions_old;

create table permissions (
  id          text primary key,
  user_id     text not null references user_profile(id) on delete cascade,
  scope       text not null check (scope in (
                'observe_screen','find_elements','move_mouse','click','type',
                'system','apps','files','terminal','web'
              )),
  mode        text not null default 'ask'
                check (mode in ('ask','approve','full','denied')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, scope)
) strict;

insert into permissions (id, user_id, scope, mode, updated_at)
select id, user_id, scope, mode, updated_at from permissions_old;

drop table permissions_old;

create index permissions_user_idx on permissions (user_id);
