-- Vector store schema. Run in the Supabase SQL Editor before `npm run ingest`.
-- The vector width (768) must match EMBEDDING_DIMENSIONS in src/lib/recipes.ts.

create extension if not exists vector;

create table if not exists recipes (
  id          bigserial primary key,
  slug        text unique not null,
  title       text not null,
  content     text not null,          -- the embedded chunk
  metadata    jsonb not null,         -- the full recipe object
  embedding   vector(768),            -- gemini-embedding-001, truncated to 768
  created_at  timestamptz not null default now()
);

-- HNSW, not ivfflat: ivfflat fixes its centroids at CREATE INDEX time, so building it
-- before ingest leaves a degenerate index that returns one irrelevant row per query.
-- Every non-HNSW index on `embedding` is dropped, whatever it is named, since a stale
-- one left under another name keeps reproducing that symptom.
do $$
declare
  stale record;
begin
  for stale in
    select indexname
    from pg_indexes
    where tablename = 'recipes'
      and indexdef ilike '%embedding%'
      and indexname <> 'recipes_embedding_hnsw_idx'
  loop
    execute format('drop index if exists %I', stale.indexname);
  end loop;
end $$;

create index if not exists recipes_embedding_hnsw_idx
  on recipes using hnsw (embedding vector_cosine_ops);

-- `1 - (a <=> b)` turns cosine distance into a similarity, so the threshold reads naturally.
create or replace function match_recipes (
  query_embedding vector(768),
  match_threshold float default 0.3,
  match_count     int   default 4
)
returns table (
  id         bigint,
  slug       text,
  title      text,
  content    text,
  metadata   jsonb,
  similarity float
)
language sql stable as $$
  select r.id, r.slug, r.title, r.content, r.metadata,
         1 - (r.embedding <=> query_embedding) as similarity
  from recipes r
  where r.embedding is not null
    and 1 - (r.embedding <=> query_embedding) > match_threshold
  order by r.embedding <=> query_embedding
  limit match_count;
$$;

-- The app reaches Postgres only via the server's service-role key; lock out every other path.
alter table recipes enable row level security;
