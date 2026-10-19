# Monitor Domos El Puma

Revisión diaria y automática del clima en los domos del **Sendero El Puma** (Santuario Yerba Loca, Lo Barnechea) para decidir cuándo subir a revisar la instalación.

**Panel:** https://cristobalbalbi-rc.github.io/monitor-domos-el-puma/

## Qué hace

Todos los días a las 06:50 (hora de verano de Chile), GitHub Actions:

1. Descarga desde [Open-Meteo](https://open-meteo.com/) el pronóstico de 14 días de tres modelos (ECMWF IFS 0,25°, DWD ICON y NOAA GFS) para Villa Paulina, el Domo 1 (Polvareda) y el Domo 2 (Anfiteatro de Leonera), corregido por altitud.
2. Descarga el historial diario (ERA5) desde la fecha en que los domos quedaron expuestos: ráfagas, temperatura mínima, nieve caída y nieve en el suelo.
3. Clasifica cada día como **apto**, **dudoso** o **no apto** con `docs/motor.js` y busca la primera ventana de días aptos seguidos.
4. Guarda los resultados en `docs/data/` (quedan en el historial de Git) y publica el panel en GitHub Pages.
5. Si cambia el veredicto, abre un *issue* con el resumen. GitHub lo envía por correo a quienes siguen el repositorio. Si se configuran los secretos `MAIL_*`, también envía un correo directo.

## Cómo se decide

- **Ráfagas, nieve nueva en 72 h y temperatura mínima** se miden en la cota del domo. La **precipitación** se toma como la máxima entre los puntos de la ruta.
- ECMWF es el modelo principal. Si ICON es más severo, el día sube un nivel. Si solo GFS ve riesgo, el día queda en «dudoso». Lo mismo ocurre si llueve con la isoterma 0 °C sobre el domo (lluvia sobre nieve).
- Veredicto:
  - **Subir:** la ventana empieza mañana.
  - **Preparar la subida:** la ventana empieza dentro de los próximos 7 días.
  - **No subir:** no hay ventana o está demasiado lejos.

La decisión final la toma el equipo en terreno, revisando la mañana previa.

## Cambiar criterios o coordenadas

Editen [`docs/config.json`](docs/config.json) directamente en GitHub (ícono del lápiz → *Commit changes*). Al guardar, la revisión vuelve a correr sola.

| Campo | Significado |
|---|---|
| `umbrales.rafaga` | `[dudoso, no apto]` en km/h |
| `umbrales.nieve72` | nieve nueva acumulada en 72 h, en cm |
| `umbrales.pp` | precipitación diaria, en mm |
| `umbrales.tmin` | temperatura mínima, en °C (más negativo es peor) |
| `ventanaDias` | días aptos seguidos que se necesitan para subir |
| `desde` | desde cuándo contar lo que soportaron los domos |
| `objetivo` | domo de la revisión diaria (`anfiteatro` o `polvareda`) |
| `aviso` | `cambios` (solo cuando cambia el veredicto) o `diario` |

Las coordenadas del Domo 2 vienen del KMZ «Campamento 2 sendero del puma». Las del Domo 1 son aproximadas.

## Ejecutar a mano

Pestaña **Actions** → «Revisión diaria de los domos» → **Run workflow**.

## Avisos por correo

- **Sin configurar nada:** cada aviso llega como *issue* con la etiqueta `aviso-domos`. Quien quiera recibirlos debe seguir el repositorio (**Watch** → *All activity*, o *Custom* → *Issues*).
- **Correo directo (opcional):** en *Settings → Secrets and variables → Actions*, creen estos secretos:
  - `MAIL_USERNAME`: la cuenta de Gmail que envía.
  - `MAIL_PASSWORD`: una [contraseña de aplicación](https://myaccount.google.com/apppasswords) de esa cuenta.
  - `MAIL_TO`: los destinatarios, separados por coma.

## Pruebas sin red

```bash
OFFLINE=ruta/a/fixtures HOY=2026-10-19 node scripts/revision.mjs
```

`fixtures/` debe tener `pronostico.json`, `historico.json` y `clima-<id>.json` con el formato de respuesta de Open-Meteo.

## Limitaciones

Son valores de modelo, con celdas de 9 a 25 km, no mediciones en el sitio. Un anfiteatro glaciar puede canalizar o abrigar el viento. Úsenlos como indicador de severidad.
