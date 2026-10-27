// Prueba el schema completo en Postgres local (PGlite) con stubs de auth/storage de Supabase: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
const files = process.argv.slice(2)
await db.exec(`
create role anon; create role authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name,'/'))[1:1] $$;
create publication supabase_realtime;
`)
for (const f of files) await db.exec(readFileSync(f, 'utf8'))
console.log('schema OK')

const mk = async (email, name) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { name }])).rows[0].id
const A = await mk('a@x.com', 'Ana'), B = await mk('b@x.com', 'Beto'), C = await mk('c@x.com', '')
const as = async uid => { await db.exec(`reset role`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]); await db.exec(`set role authenticated`) }
const q = async (sql, p) => (await db.query(sql, p)).rows
const ok = (cond, msg) => { if (!cond) { console.log('FAIL', msg); process.exitCode = 1 } else console.log('ok  ', msg) }
const fails = async (fn, msg) => { try { await fn(); ok(false, msg + ' (debió fallar)') } catch (e) { ok(true, `${msg} -> ${e.message}`) } }

ok((await q(`select name from profiles where id=$1`, [C]))[0].name === 'c', 'perfil creado con prefijo email')
await as(A); const [X] = await q(`insert into books (title, author) values ('Rayuela','Cortázar') returning id`)
const [X2] = await q(`insert into books (title, author) values ('Ficciones','Borges') returning id`)
await as(B); const [Y] = await q(`insert into books (title, author) values ('Pedro Páramo','Rulfo') returning id`)
await fails(() => q(`insert into wishes (title) values ('ab')`), 'deseo muy corto rechazado')
await q(`insert into wishes (title, author) values ('ficciones', 'BORGES')`)
await as(A); await q(`insert into wishes (title) values ('pedro paramo')`)
await as(B); ok((await q(`select title from wish_matches()`)).map(r => r.title).join() === 'Ficciones', 'deseo encuentra libro (mayúsculas)')
let dm = await q(`select * from double_matches()`)
ok(dm.length === 1 && dm[0].their_title === 'Ficciones' && dm[0].my_title === 'Pedro Páramo', 'match doble ignora acentos')
await fails(() => q(`update profiles set trades = 99 where id = $1`, [B]), 'B no puede inflar sus intercambios')
await fails(() => q(`update profiles set is_admin = true where id = $1`, [B]), 'B no puede hacerse admin')
await q(`update profiles set bio = 'hola' where id = $1`, [B]); ok(true, 'B edita su bio')
await fails(() => q(`select make_offer($1, 10, '{}', '')`, [Y.id]), 'no ofertar libro propio')
await fails(() => q(`select make_offer($1, 10, array[$2]::uuid[], '')`, [X.id, X2.id]), 'no ofrecer libros ajenos')
const [{ make_offer: O }] = await q(`select make_offer($1, 50, array[$2]::uuid[], 'hola')`, [X.id, Y.id])
await fails(() => q(`select make_offer($1, 1, '{}', '')`, [X.id]), 'una oferta abierta por libro')
await fails(() => q(`insert into offers (book_title, owner_id, bidder_id) values ('x', $1, $2)`, [A, B]), 'insert directo en offers bloqueado')
await fails(() => q(`insert into messages (offer_id, body) values ($1, 'hey')`, [O]), 'chat cerrado antes de aceptar')
await as(A); await q(`select counter_offer($1, 80, array[$2]::uuid[], 'mas plata')`, [O, Y.id])
let [o] = await q(`select * from offers where id=$1`, [O]); ok(o.owner_ok && !o.bidder_ok && o.money == 80, 'contraoferta resetea acuerdo del otro')
await q(`select accept_offer($1)`, [O]); [o] = await q(`select status from offers where id=$1`, [O]); ok(o.status === 'open', 'aceptar solo de un lado no abre chat')
await as(B); await q(`select accept_offer($1)`, [O]); [o] = await q(`select status from offers where id=$1`, [O]); ok(o.status === 'accepted', 'ambos aceptan -> accepted')
ok((await q(`select available from books where id=$1`, [X.id]))[0].available === false, 'libro queda reservado')
await q(`insert into messages (offer_id, body) values ($1, 'nos vemos?')`, [O]); ok(true, 'B escribe en chat')
await as(C); ok((await q(`select * from offers`)).length === 0, 'C no ve ofertas ajenas')
ok((await q(`select * from messages`)).length === 0, 'C no ve chats ajenos')
await fails(() => q(`insert into messages (offer_id, body) values ($1, 'spam')`, [O]), 'C no escribe en chat ajeno')
await fails(() => q(`select confirm_place($1)`, [O]), 'C no confirma lugar ajeno')
await as(A); await fails(() => q(`select confirm_place($1)`, [O]), 'no confirmar sin propuesta')
await q(`select propose_place($1, 14.6, -90.5, 'Parque Central')`, [O])
await as(B); await q(`select propose_place($1, 14.61, -90.51, 'Mejor en la Sexta')`, [O])
;[o] = await q(`select * from offers where id=$1`, [O]); ok(!o.place_owner_ok && o.place_bidder_ok, 'nueva propuesta resetea confirmación')
await as(A); await q(`select confirm_place($1)`, [O])
;[o] = await q(`select * from offers where id=$1`, [O]); ok(o.place_confirmed_at && o.place === 'Mejor en la Sexta', 'lugar registrado')
await fails(() => q(`select propose_place($1, 1, 1, 'x')`, [O]), 'lugar registrado queda bloqueado')
ok((await q(`select available from books where id=$1`, [Y.id]))[0].available === false, 'libro ofrecido también reservado')
await fails(() => q(`insert into reviews (offer_id, reviewee_id, stars) values ($1, $2, 5)`, [O, B]), 'no reseñar antes de completar')
await q(`select mark_done($1)`, [O])
ok(!(await q(`select completed_at from offers where id=$1`, [O]))[0].completed_at, 'hecho de un lado no completa')
await as(B); await q(`select mark_done($1)`, [O])
ok((await q(`select completed_at from offers where id=$1`, [O]))[0].completed_at, 'ambos marcan hecho -> completado')
ok((await q(`select owner_id from books where id=$1`, [X.id]))[0].owner_id === B, 'libro pedido pasa a B')
ok((await q(`select owner_id from books where id=$1`, [Y.id]))[0].owner_id === A, 'libro ofrecido pasa a A')
ok((await q(`select * from journeys where offer_id=$1`, [O])).length === 2, 'viaje registrado para ambos libros')
ok((await q(`select trades from profiles where id=$1`, [A]))[0].trades === 1, 'contador de intercambios')
await fails(() => q(`select reject_offer($1)`, [O]), 'no cancelar tras completar')
await q(`insert into reviews (offer_id, reviewee_id, stars, comment) values ($1, $2, 5, 'puntual')`, [O, A]); ok(true, 'B reseña a A')
await fails(() => q(`insert into reviews (offer_id, reviewee_id, stars) values ($1, $2, 4)`, [O, A]), 'una reseña por intercambio')
await as(C); await fails(() => q(`insert into reviews (offer_id, reviewee_id, stars) values ($1, $2, 1)`, [O, A]), 'C no reseña trato ajeno')
await as(A); const [Z] = await q(`insert into books (title, author) values ('Hombres de maíz','Asturias') returning id`)
await as(B); const [{ make_offer: O3 }] = await q(`select make_offer($1, 20, '{}', '')`, [Z.id])
await as(C); const [{ make_offer: O4 }] = await q(`select make_offer($1, 30, '{}', '')`, [Z.id])
await as(A); await q(`select accept_offer($1)`, [O3])
await fails(() => q(`select accept_offer($1)`, [O4]), 'no aceptar dos tratos por el mismo libro')
await q(`select reject_offer($1)`, [O3]); ok((await q(`select available from books where id=$1`, [Z.id]))[0].available, 'cancelar trato libera el libro')
await as(C); await q(`insert into blocks (blocked_id) values ($1)`, [A])
await fails(() => q(`select make_offer($1, 5, '{}', '')`, [X2.id]), 'bloqueo impide ofertar')
await q(`delete from blocks where blocked_id = $1`, [A])
const [{ make_offer: O2 }] = await q(`select make_offer($1, 5, '{}', '')`, [X2.id]); ok(!!O2, 'tras desbloquear sí oferta')
await as(A); await q(`select reject_offer($1)`, [O2]); ok((await q(`select status from offers where id=$1`, [O2]))[0].status === 'rejected', 'A rechaza')
await fails(() => q(`select admin_users()`), 'no admin no lista usuarios')
await as(B); await q(`insert into reports (user_id, reason) values ($1, 'raro')`, [C]); ok(true, 'B reporta a C')
ok((await q(`select * from reports`)).length === 0, 'B no ve reportes')
await db.exec(`reset role`); await db.query(`update profiles set is_admin = true where id = $1`, [A])
await as(A); ok((await q(`select * from admin_users()`)).length === 3, 'admin lista usuarios con email')
ok((await q(`select * from reports`)).length === 1, 'admin ve reportes')
await q(`select set_banned($1, true)`, [C])
await as(C); await fails(() => q(`insert into books (title, author) values ('x','y')`), 'suspendido no publica')
await as(B); ok((await q(`select * from offers where id=$1`, [O]))[0].place_confirmed_at, 'historial intacto')
await q(`delete from books where id=$1`, [X.id])
await as(B); ok((await q(`select book_id, book_title from offers where id=$1`, [O]))[0].book_title === 'Rayuela', 'borrar libro conserva oferta registrada')
await q(`insert into storage.objects (bucket_id, name) values ('photos', $1)`, [`${B}/f.jpg`]); ok(true, 'sube foto a su carpeta')
await fails(() => q(`insert into storage.objects (bucket_id, name) values ('photos', $1)`, [`${A}/f.jpg`]), 'no sube a carpeta ajena')
