-- Comelibros: pegar completo en Supabase > SQL Editor > Run.
-- Toda la lógica de negocio vive aquí (RLS + funciones), así web y app nativa usan las mismas reglas.

-- Helpers internos van en "private" (no expuesto por la API REST); en "public" solo tablas y RPC.
create schema private;
grant usage on schema private to anon, authenticated;

-- ========== PERFILES ==========
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '' check (length(name) <= 80),
  city text not null default '' check (length(city) <= 80),
  bio text not null default '' check (length(bio) <= 1000),
  avatar text,                       -- ruta en storage 'photos'
  is_admin boolean not null default false,
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  insert into profiles (id, name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.is_admin() returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create function private.banned(uid uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce((select banned from profiles where id = uid), false)
$$;

create function private.active() returns boolean
language sql stable set search_path = public, private as $$
  select auth.uid() is not null and not private.banned(auth.uid())
$$;

alter table public.profiles enable row level security;
create policy "perfiles publicos" on public.profiles for select using (true);
create policy "editar mi perfil" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- el usuario solo puede tocar estas columnas; is_admin/banned solo vía funciones de admin
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name, city, bio, avatar) on public.profiles to authenticated;

-- ========== BLOQUEOS ==========
create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
create policy "mis bloqueos" on public.blocks for select using (blocker_id = auth.uid());
create policy "bloquear" on public.blocks for insert with check (blocker_id = auth.uid());
create policy "desbloquear" on public.blocks for delete using (blocker_id = auth.uid());

create function private.blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

-- ========== REPORTES ==========
create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null default auth.uid() references public.profiles on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create policy "reportar" on public.reports for insert with check (reporter_id = auth.uid() and private.active());
create policy "admin ve reportes" on public.reports for select using (private.is_admin());
create policy "admin resuelve" on public.reports for update using (private.is_admin());

-- ========== LIBROS ==========
create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  author text not null check (length(trim(author)) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  photos text[] not null default '{}' check (cardinality(photos) <= 5),
  available boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.books (owner_id);
create index on public.books (created_at desc) where available;
alter table public.books enable row level security;
create policy "ver libros" on public.books for select
  using (not private.banned(owner_id) or owner_id = auth.uid() or private.is_admin());
create policy "publicar" on public.books for insert with check (owner_id = auth.uid() and private.active());
create policy "editar mis libros" on public.books for update
  using (owner_id = auth.uid() and private.active()) with check (owner_id = auth.uid());
create policy "borrar libros" on public.books for delete using (owner_id = auth.uid() or private.is_admin());

-- ========== OFERTAS (negociación + lugar de encuentro) ==========
-- Una oferta = plata (opcional) + libros del ofertante (opcional) + nota, sobre un libro.
-- Cualquiera de los dos puede contraofertar; quien cambia los términos queda "de acuerdo" y el otro no.
-- Cuando ambos están de acuerdo: status 'accepted' y se abre el chat.
-- El lugar funciona igual: uno propone (pin + descripción), el otro confirma, y queda registrado.
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references public.books on delete set null,
  book_title text not null,          -- copia, por si el libro se borra después
  owner_id uuid not null references public.profiles on delete cascade,   -- dueño del libro
  bidder_id uuid not null references public.profiles on delete cascade,  -- quien oferta
  money numeric(12,2) not null default 0 check (money >= 0),
  books uuid[] not null default '{}' check (cardinality(books) <= 20),   -- libros del ofertante
  note text not null default '' check (length(note) <= 1000),
  owner_ok boolean not null default false,
  bidder_ok boolean not null default true,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  place text check (length(place) <= 500),
  place_owner_ok boolean not null default false,
  place_bidder_ok boolean not null default false,
  place_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_open_offer on public.offers (book_id, bidder_id) where status = 'open';
create index on public.offers (owner_id);
create index on public.offers (bidder_id);
alter table public.offers enable row level security;
create policy "ver mis ofertas" on public.offers for select
  using (auth.uid() in (owner_id, bidder_id) or private.is_admin());
-- escribir solo vía funciones
revoke insert, update, delete on public.offers from anon, authenticated;

create function private.check_books(p_books uuid[], uid uuid) returns void
language plpgsql stable security definer set search_path = public, private as $$
begin
  if exists (select 1 from unnest(coalesce(p_books, '{}')) x
             where not exists (select 1 from books where id = x and owner_id = uid and available)) then
    raise exception 'Algún libro ofrecido no es del ofertante o ya no está disponible';
  end if;
end $$;

-- trae la oferta bloqueada para actualizar, validando que quien llama participa
create function private.my_offer(p_offer uuid) returns public.offers
language plpgsql security definer set search_path = public, private as $$
declare o offers;
begin
  select * into o from offers where id = p_offer for update;
  if not found or auth.uid() is null or auth.uid() not in (o.owner_id, o.bidder_id) then
    raise exception 'Oferta no encontrada';
  end if;
  if not active() then raise exception 'Tu cuenta está suspendida'; end if;
  if blocked(o.owner_id, o.bidder_id) then raise exception 'Hay un bloqueo entre ustedes'; end if;
  return o;
end $$;

create function public.make_offer(p_book uuid, p_money numeric, p_books uuid[], p_note text) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare b books; new_id uuid;
begin
  if not active() then raise exception 'Necesitas una cuenta activa'; end if;
  select * into b from books where id = p_book;
  if not found or not b.available then raise exception 'Libro no disponible'; end if;
  if b.owner_id = auth.uid() then raise exception 'No puedes ofertar por tu propio libro'; end if;
  if banned(b.owner_id) or blocked(b.owner_id, auth.uid()) then raise exception 'No puedes ofertar a este usuario'; end if;
  if exists (select 1 from offers where book_id = p_book and bidder_id = auth.uid() and status = 'open') then
    raise exception 'Ya tienes una oferta abierta por este libro';
  end if;
  perform check_books(p_books, auth.uid());
  insert into offers (book_id, book_title, owner_id, bidder_id, money, books, note)
  values (b.id, b.title, b.owner_id, auth.uid(), coalesce(p_money, 0), coalesce(p_books, '{}'), coalesce(p_note, ''))
  returning id into new_id;
  return new_id;
end $$;

create function public.counter_offer(p_offer uuid, p_money numeric, p_books uuid[], p_note text) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers := my_offer(p_offer);
begin
  if o.status <> 'open' then raise exception 'La oferta ya no está abierta'; end if;
  perform check_books(p_books, o.bidder_id);
  update offers set money = coalesce(p_money, 0), books = coalesce(p_books, '{}'), note = coalesce(p_note, ''),
    owner_ok = (auth.uid() = owner_id), bidder_ok = (auth.uid() = bidder_id), updated_at = now()
  where id = o.id;
end $$;

create function public.accept_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers := my_offer(p_offer);
begin
  if o.status <> 'open' then raise exception 'La oferta ya no está abierta'; end if;
  update offers set owner_ok = owner_ok or auth.uid() = owner_id, bidder_ok = bidder_ok or auth.uid() = bidder_id,
    updated_at = now()
  where id = o.id returning * into o;
  if o.owner_ok and o.bidder_ok then
    perform check_books(o.books, o.bidder_id);
    update offers set status = 'accepted' where id = o.id;
    update books set available = false where id = o.book_id;  -- reservado
  end if;
end $$;

create function public.reject_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers;
begin
  -- rechazar/cancelar siempre se permite, aunque haya bloqueo
  select * into o from offers where id = p_offer for update;
  if not found or auth.uid() is null or auth.uid() not in (o.owner_id, o.bidder_id) then
    raise exception 'Oferta no encontrada';
  end if;
  if o.status = 'rejected' or o.place_confirmed_at is not null then
    raise exception 'Esta oferta ya no se puede cancelar';
  end if;
  update offers set status = 'rejected', updated_at = now() where id = o.id;
  if o.status = 'accepted' then update books set available = true where id = o.book_id; end if;
end $$;

create function public.propose_place(p_offer uuid, p_lat double precision, p_lng double precision, p_place text) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers := my_offer(p_offer);
begin
  if o.status <> 'accepted' then raise exception 'Primero ambos deben aceptar la oferta'; end if;
  if o.place_confirmed_at is not null then raise exception 'El lugar ya quedó registrado'; end if;
  if p_lat is null or p_lng is null then raise exception 'Marca el lugar en el mapa'; end if;
  update offers set lat = p_lat, lng = p_lng, place = trim(coalesce(p_place, '')),
    place_owner_ok = (auth.uid() = owner_id), place_bidder_ok = (auth.uid() = bidder_id), updated_at = now()
  where id = o.id;
end $$;

create function public.confirm_place(p_offer uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare o offers := my_offer(p_offer);
begin
  if o.status <> 'accepted' or o.lat is null then raise exception 'No hay lugar propuesto'; end if;
  if o.place_confirmed_at is not null then raise exception 'El lugar ya quedó registrado'; end if;
  update offers set place_owner_ok = place_owner_ok or auth.uid() = owner_id,
    place_bidder_ok = place_bidder_ok or auth.uid() = bidder_id, updated_at = now()
  where id = o.id returning * into o;
  if o.place_owner_ok and o.place_bidder_ok then
    update offers set place_confirmed_at = now() where id = o.id;
  end if;
end $$;

-- ========== CHAT ==========
create table public.messages (
  id bigint generated always as identity primary key,
  offer_id uuid not null references public.offers on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.messages (offer_id, id);
alter table public.messages enable row level security;
create policy "leer chat" on public.messages for select using (
  exists (select 1 from public.offers o where o.id = offer_id and (auth.uid() in (o.owner_id, o.bidder_id) or private.is_admin())));
create policy "escribir chat" on public.messages for insert with check (
  sender_id = auth.uid() and private.active() and exists (
    select 1 from public.offers o where o.id = offer_id and o.status = 'accepted'
      and auth.uid() in (o.owner_id, o.bidder_id) and not private.blocked(o.owner_id, o.bidder_id)));
revoke update, delete on public.messages from anon, authenticated;

alter publication supabase_realtime add table public.messages, public.offers;

-- ========== ADMIN ==========
create function public.admin_users() returns table (id uuid, name text, email text, city text, banned boolean, is_admin boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Solo admin'; end if;
  return query select p.id, p.name, u.email::text, p.city, p.banned, p.is_admin, p.created_at
    from profiles p join auth.users u on u.id = p.id order by p.created_at desc;
end $$;

create function public.set_banned(p_user uuid, p_banned boolean) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Solo admin'; end if;
  update profiles set banned = p_banned where id = p_user and not is_admin;
end $$;

-- RPC solo para usuarios con sesión; helpers internos no se llaman directo
revoke execute on function private.handle_new_user(), private.check_books(uuid[], uuid), private.my_offer(uuid)
  from public, anon, authenticated;
revoke execute on function public.make_offer(uuid, numeric, uuid[], text), public.counter_offer(uuid, numeric, uuid[], text),
  public.accept_offer(uuid), public.reject_offer(uuid), public.propose_place(uuid, double precision, double precision, text),
  public.confirm_place(uuid), public.admin_users(), public.set_banned(uuid, boolean)
  from public, anon;
grant execute on function public.make_offer(uuid, numeric, uuid[], text), public.counter_offer(uuid, numeric, uuid[], text),
  public.accept_offer(uuid), public.reject_offer(uuid), public.propose_place(uuid, double precision, double precision, text),
  public.confirm_place(uuid), public.admin_users(), public.set_banned(uuid, boolean)
  to authenticated;

-- ========== FOTOS (storage) ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, '{image/jpeg,image/png,image/webp}')
on conflict (id) do nothing;

create policy "subir mis fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "borrar mis fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Primer admin (cambiar email y correr aparte, después de registrarte):
-- update public.profiles set is_admin = true where id = (select id from auth.users where email = 'tu@correo.com');
