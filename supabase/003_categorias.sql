-- Comelibros 003: categorías de libros + gustos del usuario.
-- Correr después de schema.sql y 002_comunidad.sql.

-- Clasificación por palabras clave (título + autor + descripción, sin acentos). El primer grupo que coincide gana;
-- lo que no coincide con nada cae en 'novela'. ponytail: reglas a mano, ~85% de acierto; migrar a IA si el catálogo crece mucho.
create function private.guess_category(p_title text, p_author text, p_desc text) returns text
language sql immutable set search_path = '' as $$
  select case
    when t ~ 'loqueleo|barco de vapor|bambu|rodari|luna de papel|infantil|santiaguito' then 'infantil'
    when t ~ 'cazadores de sombras|kiera cass|harry potter|rowling|john green|ciudades de papel|fantasia|juvenil|la elite|skywalker|torre oscura' then 'juvenil'
    when t ~ 'misterio|policiaca|thriller|crimen|asesin|detective|christie|highsmith|benjamin black|larsson|lackberg|indridason|frobenius|carlsson|chirovici|carmen mola|le carre|himes|club dante|novela negra|negra alfaguara|la voz|espia que' then 'misterio'
    when t ~ 'blanchard|covey|liderazgo|gerente|empresa|negocio|administracion|productividad|innovar|deusto|godin|charan|prahalad|robert k. cooper|\yzara\y|guaspari|fabrica|know-how|habitos|marketing' then 'negocios'
    when t ~ 'yalom|goleman|psico|terapia|emociones|horney|burns|depres|neurotic|locura|autoayuda|sills|equipaje|sentirse bien|mujeres que corren|orientaciones sexuales|fromm|desarrollo personal|neo persona' then 'psicologia'
    when t ~ 'maucci|odisea|iliada|eneida|divina comedia|celestina|fausto|kafka|nietzsche|shakespeare|moliere|dostoi|tolstoi|cid\y|kipling|proust|fenimore|maupassant|balzac|goethe|virgilio|homero|dante|boccaccio|decameron|satiricon|esquilo|tragedias|verne|swift|gulliver|huxley|hemingway|pushkin|maugham|brecht|petron|quevedo|milton|confucio|thackeray|daudet|ovidio|horacio|hawthorne|mitos griegos|parecia un caballo|maquiavelo|calderon|babbit|amiel|ayala|guareschi|hesse|popol vuh|clasicos|obras maestras|orbis|altaya|circulo de amigos|biblioteca edaf|grandes exitos planeta|alianza' then 'clasicos'
    when t ~ '\yarte\y|pintura|acuarela|dibujo|ornamental|arqueologia|grecia|atenas|gauguin|ciencia|cientifica|universo|matematica|zoo humano|etologia|conducta animal|tecnica, desarrollo|desmond morris|national geographic|lexus|pepin|dios a los dados|etiolog|susto' then 'arte'
    when t ~ 'biblia(?! del asno)|jesus|oracion|misal|predicador|cristian|bhagavad|espiritual|iglesia|portavoz|peniel|unlit|nelson|editorial vida|kendrick|chapman|yogananda|religios|agustin|bonhoeffer|jucum|b&h|liturgy|kier|zen\y|arterburn|ocultismo|brujas|satanicos|moris es nada|san pablo|prana|batalla de cada' then 'religion'
    when t ~ 'historia|guatemala|politic|democracia|somoza|nazi|hitler|churchill|gandhi|lincoln|carlos v|colonial|arevalo|imperios|culturas|melilla|caballeria|derecho|pedagogia|sociolog|investigacion social|foucault|cenaltex|oratoria|economic|fuengirola|cultura|ocultismo|brujas|satanicos|solorzano|academica|serviprensa|universitaria|comunicacion|tecnico profesional' then 'historia'
    else 'novela'
  end
  from (select private.norm(coalesce(p_title, '') || ' ' || coalesce(p_author, '') || ' ' || coalesce(p_desc, '')) as t) x
$$;

alter table public.books add column category text
  check (category in ('novela','misterio','juvenil','clasicos','psicologia','negocios','historia','religion','arte','infantil'));
update public.books set category = private.guess_category(title, author, description);
alter table public.books alter column category set not null;
create index on public.books (category, created_at desc) where available;

-- Si el libro llega sin categoría (ej. importado o "automática" en el formulario), se adivina al insertar.
create function private.set_book_category() returns trigger
language plpgsql set search_path = public, private as $$
begin
  new.category := coalesce(new.category, private.guess_category(new.title, new.author, new.description));
  return new;
end $$;
create trigger books_set_category before insert on public.books
  for each row execute function private.set_book_category();

-- Gustos del usuario (categorías que le interesan); editable por él mismo.
alter table public.profiles add column interests text[] not null default '{}' check (cardinality(interests) <= 10);
grant update (interests) on public.profiles to authenticated;
