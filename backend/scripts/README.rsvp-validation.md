# Validación local de RSVPs por ocurrencia

Stack aislado, con datos sintéticos, para probar los cambios de contexto de ocurrencia. No usa datos, credenciales ni servicios de producción. No modifica `.env`.

## Servicios

| Servicio | Dirección |
| --- | --- |
| Backoffice | http://localhost:5173 |
| Portal | http://localhost:3000 |
| Alias del portal para enlaces compartidos y QR | http://localhost |
| API / OpenAPI | http://localhost:8000/docs |
| PostgreSQL dedicado | `127.0.0.1:25432 / edgeos_rsvp_validation` |

El alias de puerto 80 apunta al portal de puerto 3000. El tenant sintético tiene `custom_domain=localhost`: los enlaces generados usan ese hostname sin puerto. Nginx resuelve este detalle únicamente en el entorno local; no se cambia código de producción para aceptar puertos en los dominios de tenants.

Todos los listeners se publican en loopback. PostgreSQL usa el contenedor `edgeos-rsvp-validation-db` y el volumen `edgeos-rsvp-validation-data`; no se reutilizan los otros stacks locales.

`rsvp_validation.py` fuerza un destino de DB local y rechaza destinos distintos. Usa configuración sin `.env`, emails/almacenamiento/Sentry/Redis/API keys externos deshabilitados y sweeps automáticos desactivados. **No funciona el login normal por OTP porque no se envían emails.** El helper de navegador firma sesiones de las cuentas ficticias exclusivamente en este stack. No imprime ni guarda tokens en archivos, ni añade endpoints de autenticación a la aplicación.

## Datos cargados

Gathering: **RSVP Lab — Recurring Events**, slug `rsvp-lab`, timezone **Asia/Kolkata**.

7 personas ficticias, sus aplicaciones aceptadas y pases asignados; 1 administrador; 1 venue con capacidad 5. Todos los emails pertenecen al dominio reservado `example.com`.

Serie **QA Yoga — six dates, independent RSVPs**, ID `97feb3d4-b927-59d9-b309-71b402c57163`, martes y jueves a las 09:00. La primera fecha se calcula como el próximo martes al crear la DB.

La creación realizada el 5 de octubre de 2026 dejó:

| Fecha | Activos | Qué comprobar |
| --- | ---: | --- |
| 6 octubre, 09:00 | 4 | María, Bruno, Diego y Sofía; Sofía cuenta pero no muestra su nombre en el portal |
| 8 octubre, 09:00 | 3 | María, Bruno y Sofía; Pablo tiene un RSVP cancelado y no cuenta |
| 13 octubre, 10:00 | 2 | Clase separada; RSVPs propios bajo el ID del hijo, sin `occurrence_start` |
| 15 octubre, 09:00 | 0 | Ocurrencia sin participantes |
| 20 octubre, 09:00 | 5 | Aforo completo, aunque el portal muestre menos nombres por privacidad |
| 22 octubre, 09:00 | 1 | Otra ocurrencia de la misma serie |

Un RSVP histórico del host en la primera fecha permite comprobar que no se incluye en los participantes/contadores. María participa en varias fechas: esto es válido y no representa duplicados.

Otros eventos:

- Separado: `77a594af-bc41-5fce-8107-d4d8f1298149`.
- One-off **QA Community Lunch**: `f97bb931-2b68-5cde-adb6-8714fd485c0e`, 2 RSVPs.
- **QA Live Roll Call**: `823db4a7-74d8-5093-bb74-6ff2e8cf0be3`, comienza 10 minutos antes del seed y termina 50 minutos después. Permite probar asistencia en su ventana real. Tras la QA inicial quedaron María marcada por QR y Bruno por roll call; sus marcas pueden anularse desde el backoffice.

## Entrar sin enviar emails

Desde la raíz del repositorio, con `agent-browser` instalado:

```bash
.venv/bin/python backend/scripts/rsvp_validation.py browser --surface backoffice --account admin --headed
.venv/bin/python backend/scripts/rsvp_validation.py browser --surface portal --account maria --headed
```

Se abren navegadores separados ya autenticados y en la primera fecha de la serie. El helper configura las dos direcciones del portal (`localhost` y `localhost:3000`) para poder abrir sus QR/enlaces con la misma cuenta.

Otras cuentas de portal:

```bash
# Organizador y staff, para probar herramientas de gestión
.venv/bin/python backend/scripts/rsvp_validation.py browser --account organizer --headed
# Asistente sin RSVPs previos, para probar registros nuevos y el aforo completo
.venv/bin/python backend/scripts/rsvp_validation.py browser --account valeria --headed
```

Si una sesión ya está abierta en modo headless, cerrarla antes de usar `--headed`:

```bash
agent-browser --session rsvp-local-backoffice-admin close
agent-browser --session rsvp-local-portal-maria close
```

El helper imprime enlaces/confirmaciones, no tokens. Las sesiones están aisladas del navegador personal y de cuentas reales.

Para obtener los enlaces exactos con fecha y los IDs sin volver a insertar:

```bash
.venv/bin/python backend/scripts/rsvp_validation.py seed
```

El seed es idempotente: no restablece ni sobrescribe cambios de pruebas existentes.

## Reiniciar los servicios

Los servidores iniciados desde pi son temporales y se detienen al finalizar su sesión. Los contenedores/volumen persisten. Para iniciar este entorno fuera de pi:

```bash
# Contenedores ya creados
# Usar el contexto Docker local habitual (OrbStack en esta máquina).
docker start edgeos-rsvp-validation-db edgeos-rsvp-validation-portal-links
```

Ejecutar cada servidor en una terminal distinta, desde la raíz:

```bash
.venv/bin/python backend/scripts/rsvp_validation.py serve
```

```bash
VITE_API_URL=http://localhost:8000 VITE_PORTAL_DOMAIN=localhost:3000 \
  pnpm --dir backoffice dev --host 127.0.0.1 --port 5173 --strictPort
```

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000 CUSTOM_DOMAINS_ENABLED=true NEXT_TELEMETRY_DISABLED=1 \
  pnpm --dir portal dev --hostname 127.0.0.1 --port 3000
```

Para crear los contenedores por primera vez en otra máquina (si esos nombres todavía no existen):

```bash
docker run -d --name edgeos-rsvp-validation-db \
  --label purpose=edgeos-rsvp-local-validation \
  -p 127.0.0.1:25432:5432 \
  -v edgeos-rsvp-validation-data:/var/lib/postgresql/data \
  -e POSTGRES_USER=rsvp_local -e POSTGRES_PASSWORD=rsvp-local-only \
  -e POSTGRES_DB=edgeos_rsvp_validation postgres:17.4

# Esperar hasta que pg_isready confirme que la DB está lista.
docker exec edgeos-rsvp-validation-db pg_isready -U rsvp_local -d edgeos_rsvp_validation
.venv/bin/python backend/scripts/rsvp_validation.py migrate
.venv/bin/python backend/scripts/rsvp_validation.py seed

docker run -d --name edgeos-rsvp-validation-portal-links \
  --label purpose=edgeos-rsvp-local-validation \
  -p 127.0.0.1:80:80 \
  -v "$PWD/backend/scripts/rsvp_validation.nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx:1.28-alpine
```

No ejecutar el seed general `init_db`: este laboratorio tiene su propia configuración y fixtures. Si se quiere una DB nueva con fechas relativas al día de hoy, eliminar **únicamente** el contenedor/volumen `edgeos-rsvp-validation-db` / `edgeos-rsvp-validation-data` y volver a crearlos; eso descarta todos los cambios locales de QA.

## Comprobaciones realizadas

```bash
.venv/bin/python backend/scripts/rsvp_validation.py validate
```

**26 comprobaciones contra la API levantada**, sin modificar filas: fechas/contadores por ocurrencia en ambos endpoints, resolución sin `occ`, hijo separado y RSVP del usuario, privacidad, exclusión del host, fechas inválidas y fecha excluida, `409 Already registered`, `409 Event is full`.

En navegador:

- Backoffice/portal muestran 4 RSVPs el 6 y 3 el 8; la fecha y listas cambian juntas.
- Sofía no aparece en el portal, pero ocupa una plaza.
- El hijo separado muestra 2 RSVPs, la fecha reprogramada a 10:00 y María como `Going`.
- Fecha inválida: backoffice muestra error; portal muestra `Event not found`; ninguno queda en skeleton.
- Cancelar María en el 6 reduce el contador a 3, sin cambiar su RSVP `Going` del 8. Reinscribirla en el 6 restaura el contador a 4. Los datos de partida de la serie quedaron restaurados.
- Check-in QR de María y roll call de Bruno se registran y aparecen en backoffice, con su método/historial.

Evidencia local: `/tmp/edgeos-rsvp-validation/screenshots/` y `/tmp/edgeos-rsvp-validation/videos/`.

### Sección de otras ocurrencias en backoffice

En el detalle de la serie o de un hijo separado, abrir **Other occurrences in this series**, debajo de los participantes de la fecha actual:

- Incluye todas las fechas programadas dentro del rango mostrado, también las que tienen **0 RSVPs**. La fecha actual no se repite.
- Al abrir la sección, todas las fechas muestran directamente sus propios rosters de RSVPs activos, sin desplegables por fecha. El 8 de octubre muestra 3; el 15 muestra **No active RSVPs**; el hijo del 13 muestra 2 y **Separate occurrence**.
- **View occurrence** abre la fecha exacta del master con `occ`, o el ID propio del hijo sin `occ`. Los nombres accesibles de los enlaces incluyen la fecha.
- No hay acciones de asistencia/edición/cancelación dentro de esta sección; las operaciones permanecen en el detalle correspondiente.
- El rango mostrado siempre es el del **gathering completo**, incluidos el primer y último día. No hay botones Previous dates / Next dates / Default dates, ni rangos derivados de la fecha seleccionada o de la duración de la serie.
- Si faltan las fechas del gathering, se indica que hay que configurarlas; no se inventa un rango alternativo. Las fechas inválidas también producen un error controlado.
- La API expande internamente el calendario en bloques para cubrir gatherings largos sin cortar las fechas al llegar al límite de 1.000 resultados del motor de recurrencia. Las ventanas explícitas de la API siguen limitadas a 366 días; el backoffice no las utiliza.
- RSVPs activos con timestamps obsoletos o sin fecha en un master recurrente aparecen en un bloque separado: **RSVPs outside the current schedule**, sin enlaces a ocurrencias inválidas. No se confunden con RSVPs válidos que simplemente quedan fuera del rango visible.

API administrativa nueva: `GET /api/v1/events/{event_id}/series-summary`. Es de lectura; resuelve hijos al master, respeta tenant/rol/scope administrativo y no es accesible a sesiones o API keys del portal. No requiere migración ni cambia registros.

Comprobado en navegador: fechas 8/13/15/20/22 desde el detalle del 6; rosters independientes; navegación a la fecha vacía; navegación al hijo separado y vuelta a las otras fechas desde ese hijo. Evidencia: `screenshots/backoffice-other-occurrences.png`.

Validación automatizada: **227 tests backend** de serie/ocurrencia/RSVP/recurrencia/asistencia/visibilidad y **20 tests de UI de eventos**, más ambos checks TypeScript. En la última ejecución de la suite completa del backoffice, con `NODE_OPTIONS=--no-experimental-webstorage` y `VITE_PORTAL_DOMAIN=localhost:3000`, terminó con **625 aprobados y 1 fallo ajeno a eventos** en `src/lib/salesFlowSectionSummary.test.ts` (falta el resumen de Payment Provider). Esos archivos no se modificaron en esta entrega.

Al preparar el PR sobre el `dev` actualizado, la suite completa pasó **4.369 tests backend** (19 omitidos) y **1.409 tests portal**, junto con ambos checks TypeScript y el build de producción del backoffice. El PR se abre en borrador: quedan documentados el caso de la primera fecha excluida, los registros antiguos con fecha en hijos separados y la inicialización de settings del helper local antes de desactivar dotenv. No se incluye el rediseño de la edición/reprogramación de series.

### Incidencia encontrada: la landing QR queda en carga en modo dev

**Alcance confirmado:** portal ejecutado con `next dev`. No se ha comprobado si ocurre en un build de producción. La causa todavía no se ha investigado; no se amplió esta entrega para corregirla.

Reproducción, repetida después de recargar:

1. Entrar como María. Evidencia: `screenshots/qr-step-1-signed-in.png`.
2. Abrir `http://localhost/portal/rsvp-lab/events/823db4a7-74d8-5093-bb74-6ff2e8cf0be3/check-in` dentro de la ventana de asistencia.
3. La API devuelve `200` y registra el check-in, pero la pantalla permanece en **Checking you in...**. Evidencia: `screenshots/qr-step-2-loading.png` y `screenshots/portal-qr-stuck-retry.png`.
4. El backoffice confirma la marca **QR scan by Maria Lopez** y el roll call de Bruno: `screenshots/backoffice-live-qr-and-rollcall.png`.

Vídeo: `videos/qr-loading-repro.webm`. Es un problema de finalización visual de la landing, no una prueba fallida de persistencia del check-in. No hay errores JS mostrados por el navegador en esta reproducción.
