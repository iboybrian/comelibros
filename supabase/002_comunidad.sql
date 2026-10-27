-- Comelibros 002: deseos + matches, intercambio completado + reseñas, viaje del libro.
-- Correr después de schema.sql.

-- ========== BÚSQUEDA SIN ACENTOS ==========
create function private.norm(t text) returns text
language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(t, '')), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou')
$$;

create function private.wish_match(b_title text, b_author text, w_title text, w_author text) returns boolean
language sql immutable set search_path = '' as $$
  select private.norm(b_title) like '%' || private.norm(w_title) || '%'
     and (private.norm(w_author) = '' or private.norm(b_author) like '%' || private.norm(w_author) || '%')
$$;

-- ========== LISTA DE DESEOS ==========
create table public.wishes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null check (length(trim(title)) between 3 and 200),
  author text not null default '' check (length(author) <= 200),
  created_at timestamptz not null default now()
);
create index on public.wishes (user_id);
alter table public.wishes enable row level security;
-- públicos: en el perfil se ve qué busca cada quien (ayuda a ofertar)
create policy "ver deseos" on public.wishes for select using (true);
create policy "agregar deseo" on public.wishes for insert with check (user_id = (select auth.uid()) and private.active());
create policy "borrar deseo" on public.wishes for delete using (user_id = (select auth.uid()));

-- libros disponibles que coinciden con mis deseos
create function public.wish_matches() returns setof public.books
language sql stable set search_path = public, private as $$
  select b.* from books b
  where b.available and b.owner_id <> auth.uid() and not blocked(b.owner_id, auth.uid())
    and exists (select 1 from wishes w where w.user_id = auth.uid() and wish_match(b.title, b.author, w.title, w.author))
  order by b.created_at desc
  limit 30
$$;

-- "match doble": tiene algo que busco y busca algo que tengo
create function public.double_matches()
returns table (their_book uuid, their_title text, my_book uuid, my_title text, user_id uuid, user_name text)
language sql stable set search_path = public, private as $$
  select distinct on (b.id, m.id) b.id, b.title, m.id, m.title, p.id, p.name
  from wishes w
  join books b on wish_match(b.title, b.author, w.title, w.author)
  join wishes w2 on w2.user_id = b.owner_id
  join books m on m.owner_id = auth.uid() and wish_match(m.title, m.author, w2.title, w2.author)
  join profiles p on p.id = b.owner_id
  where w.user_id = auth.uid() and b.available and m.available and b.owner_id <> auth.uid()
    and not blocked(b.owner_id, auth.uid())
  limit 20
$$;

-- ========== INTERCAMBIO COMPLETADO ==========
alter table public.offers
  add column done_owner boolean not null default false,
  add column done_bidder boolean not null default false,
  add column completed_at timestamptz;
alter table public.profiles add column trades int not null default 0;  -- no editable por el usuario (grant por columnas)

-- viaje del libro: cada cambio de dueño queda registrado
create table public.journeys (
  id bigint generated always as identity primary key,
  book_id uuid not null references public.books on delete cascade,
  from_id uuid references public.profiles on delete set null,
  to_id uuid references public.profiles on delete set null,
  offer_id uuid references public.offers on delete set null,
  created_at timestamptz not null default now()
);
create index on public.journeys (book_id);
alter table public.journeys enable row level security;
create policy "viajes publicos" on public.journeys for select using (true);
revoke insert, update, delete on public.journeys from anon, authenticated;

-- al aceptar: también se reservan los libros ofrecidos, y no se puede aceptar si el libro ya se comprometió en otro trato
create or replace function public.accept_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers := my_offer(p_offer);
begin
  if o.status <> 'open' then raise exception 'La oferta ya no está abierta'; end if;
  update offers set owner_ok = owner_ok or auth.uid() = owner_id, bidder_ok = bidder_ok or auth.uid() = bidder_id,
    updated_at = now()
  where id = o.id returning * into o;
  if o.owner_ok and o.bidder_ok then
    if not exists (select 1 from books where id = o.book_id and owner_id = o.owner_id and available) then
      raise exception 'El libro ya no está disponible';
    end if;
    perform check_books(o.books, o.bidder_id);
    update offers set status = 'accepted' where id = o.id;
    update books set available = false where id = o.book_id or id = any(o.books);
  end if;
end $$;

-- se puede cancelar hasta que ambos marquen el intercambio como hecho
create or replace function public.reject_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers;
begin
  select * into o from offers where id = p_offer for update;
  if not found or auth.uid() is null or auth.uid() not in (o.owner_id, o.bidder_id) then
    raise exception 'Oferta no encontrada';
  end if;
  if o.status = 'rejected' or o.completed_at is not null then
    raise exception 'Esta oferta ya no se puede cancelar';
  end if;
  update offers set status = 'rejected', updated_at = now() where id = o.id;
  if o.status = 'accepted' then
    update books set available = true where id = o.book_id or id = any(o.books);
  end if;
end $$;

create function public.mark_done(p_offer uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers := my_offer(p_offer);
begin
  if o.status <> 'accepted' or o.place_confirmed_at is null then raise exception 'Primero registren el lugar de encuentro'; end if;
  if o.completed_at is not null then raise exception 'El intercambio ya está completado'; end if;
  update offers set done_owner = done_owner or auth.uid() = owner_id, done_bidder = done_bidder or auth.uid() = bidder_id,
    updated_at = now()
  where id = o.id returning * into o;
  if o.done_owner and o.done_bidder then
    update offers set completed_at = now() where id = o.id;
    update profiles set trades = trades + 1 where id in (o.owner_id, o.bidder_id);
    -- los libros cambian de dueño; el nuevo dueño decide si lo vuelve a publicar
    insert into journeys (book_id, from_id, to_id, offer_id)
      select id, owner_id, case when owner_id = o.owner_id then o.bidder_id else o.owner_id end, o.id
      from books
      where (id = o.book_id and owner_id = o.owner_id) or (id = any(o.books) and owner_id = o.bidder_id);
    update books set owner_id = case when owner_id = o.owner_id then o.bidder_id else o.owner_id end, available = false
      where (id = o.book_id and owner_id = o.owner_id) or (id = any(o.books) and owner_id = o.bidder_id);
  end if;
end $$;

revoke execute on function public.mark_done(uuid) from public, anon;
grant execute on function public.mark_done(uuid) to authenticated;

-- ========== RESEÑAS ==========
create table public.reviews (
  offer_id uuid not null references public.offers on delete cascade,
  reviewer_id uuid not null default auth.uid() references public.profiles on delete cascade,
  reviewee_id uuid not null references public.profiles on delete cascade,
  stars int not null check (stars between 1 and 5),
  comment text not null default '' check (length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (offer_id, reviewer_id)
);
create index on public.reviews (reviewee_id);
alter table public.reviews enable row level security;
create policy "reseñas publicas" on public.reviews for select using (true);
create policy "reseñar" on public.reviews for insert with check (
  reviewer_id = (select auth.uid()) and private.active() and exists (
    select 1 from public.offers o where o.id = offer_id and o.completed_at is not null
      and ((o.owner_id = reviewer_id and o.bidder_id = reviewee_id) or (o.bidder_id = reviewer_id and o.owner_id = reviewee_id))));
revoke update, delete on public.reviews from anon, authenticated;
