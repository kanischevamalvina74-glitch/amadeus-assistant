-- Один ключ на провайдера: повторная установка обновляет секрет, а не создаёт дубликат.
-- Удаляем возможные дубликаты, оставляя самую свежую запись.
delete from api_credentials
where id not in (
  select id from (
    select id,
           row_number() over (
             partition by user_id, provider_id order by updated_at desc, created_at desc
           ) as rn
    from api_credentials
  ) where rn = 1
);

create unique index if not exists api_credentials_user_provider_idx
  on api_credentials (user_id, provider_id);
