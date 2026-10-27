# Comelibros

Intercambio de libros en Guatemala: publicas tus libros con fotos y recibes ofertas en plata, en libros o en ambas. Cuando las dos partes aceptan se abre un chat, y el lugar de encuentro (pin en el mapa más una descripción) queda registrado cuando ambos lo confirman.

**Stack:** React + Vite (frontend) · Supabase (login, base de datos, fotos, chat en tiempo real) · Vercel (hosting). Todas las reglas viven en `supabase/schema.sql` (RLS + funciones), así que la futura app nativa usa exactamente las mismas.

## Puesta en marcha (una sola vez)

1. **Supabase:** crea una cuenta en https://supabase.com y luego un proyecto nuevo (gratis). Elige la región más cercana: `East US` o `São Paulo`.
2. **Base de datos:** entra a SQL Editor y corre, en orden, `supabase/schema.sql` y `supabase/002_comunidad.sql` (pega cada uno y dale a *Run*).
3. **Auth:** en Authentication > URL Configuration:
   - *Site URL*: tu dominio de Vercel (por ejemplo `https://comelibros.vercel.app`).
   - *Redirect URLs*: agrega `http://localhost:5173` y tu dominio.
   - Email/contraseña y enlace mágico ya vienen activos.
   - **Ojo:** el correo de Supabase gratis está limitado a unos pocos emails por hora. Para producción configura SMTP propio (Resend, Brevo, etc.) en Authentication > Emails > SMTP Settings.
4. **Claves:** en Project Settings > API copia la *Project URL* y la *publishable/anon key*. Crea un archivo `.env` (usa `.env.example` como guía).
5. **Local:**
   ```
   npm install
   npm run dev
   ```
6. **Primer admin:** regístrate en la app y después corre esto en el SQL Editor:
   ```sql
   update public.profiles set is_admin = true where id = (select id from auth.users where email = 'tu@correo.com');
   ```
7. **Publicar:** sube el repo a GitHub, impórtalo en https://vercel.com y agrega las 2 variables `VITE_SUPABASE_*` en Settings > Environment Variables. `vercel.json` ya resuelve las rutas de la SPA.

## Cómo funciona una oferta

1. B ve un libro de A y ofrece plata (Q) y/o libros suyos, más un mensaje.
2. Cualquiera de los dos puede contraofertar. Quien cambia los términos queda "de acuerdo" y al otro le toca responder.
3. Cuando ambos aceptan, el libro queda reservado (no disponible) y se abre el chat.
4. Uno propone el lugar en el mapa y escribe una descripción. El otro lo confirma o propone otro.
5. Con las dos confirmaciones el lugar queda registrado con fecha y ya no se puede cambiar ni cancelar.

6. Tras encontrarse, ambos marcan **"intercambio hecho"**: los libros cambian de dueño solos, queda registrado en el **viaje del libro** (visible en su página) y cada uno puede dejar una **reseña** de 1 a 5 estrellas.

El pago se hace en persona; la app no maneja dinero.

## Comunidad

- **Lista de deseos** (en tu perfil): en Explorar ves quién tiene esos libros. La búsqueda ignora mayúsculas y acentos.
- **Match doble**: si alguien tiene lo que buscas y busca algo tuyo, aparece arriba en Explorar con el botón "Proponer cambio".
- **Descubrir** (`/descubrir`): un libro a la vez; desliza → si te interesa, ← si no. Primero salen los de tu departamento.
- **Seguridad**: consejos en el chat, aviso si intentas pasar un teléfono o WhatsApp, y el botón "Lugares públicos" en el mapa sugiere bibliotecas, cafés, comisarías y centros comerciales cercanos (datos de OpenStreetMap).

## Moderación

- **Usuarios:** pueden bloquear a otros (dejan de poder ofertarse y chatear) y reportarlos.
- **Admin** (`/admin`): ve los reportes, busca usuarios por nombre o email, suspende y reactiva cuentas y borra libros. Una cuenta suspendida no puede publicar, ofertar ni chatear, y sus libros se ocultan.

## Pruebas

`npm run test:db` corre el schema en un Postgres local (PGlite) y prueba el flujo completo: ofertas, contraofertas, chat, lugar, bloqueos, suspensiones y permisos.

## App nativa (después)

La forma más corta es envolver esta misma web con [Capacitor](https://capacitorjs.com) (`npm i @capacitor/core @capacitor/cli && npx cap init && npx cap add android ios`), con el mismo código y el mismo backend.
