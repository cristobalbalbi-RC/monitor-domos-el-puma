# Monitor Domos El Puma

Revisión diaria y automática del clima en los domos del **Sendero El Puma** (Santuario Yerba Loca, Lo Barnechea) para decidir cuándo subir a revisar la instalación.

**Panel:** https://cristobalbalbi-rc.github.io/monitor-domos-el-puma/

## Qué hace

Todos los días a las 06:50 (hora de verano de Chile), GitHub Actions:

1. Descarga desde [Open-Meteo](https://open-meteo.com/) el pronóstico de 14 días de tres modelos (ECMWF IFS 0,25°, DWD ICON y NOAA GFS) para Villa Paulina, el Domo 1 (Polvareda) y el Domo 2 (Anfiteatro de Leonera), corregido por altitud.
2. Descarga el historial diario (ERA5) desde la fecha en que los domos quedaron expuestos: ráfagas, temperatura mínima, nieve caída y nieve en el suelo.
3. Clasifica cada día como **apto**, **dudoso** o **no apto** con `docs/motor.js` y busca la primera ventana de días seguidos aptos (o, con precaución, sin ningún «no apto»).
4. Guarda los resultados en `docs/data/` (quedan en el historial de Git) y publica el panel en GitHub Pages.
5. Si cambia el veredicto, abre un *issue* con el resumen. GitHub lo envía por correo a quienes siguen el repositorio. Si se configuran los secretos `MAIL_*`, también envía un correo directo.

## Cómo se decide

- **Ráfagas, nieve nueva en 72 h y temperatura mínima** se miden en la cota del domo. La **precipitación** se toma como la máxima entre los domos de la ruta hasta el destino.
- La **lluvia en Villa Paulina** se evalúa aparte (`ppBase`), por remociones en masa en el acceso, con los umbrales del Protocolo de Invierno (15 y 25 mm).
- **Lluvia sobre nieve:** 2 mm o más de lluvia (no nieve) en la cota del domo deja el día en «dudoso».
- ECMWF es el modelo principal. ICON solo pesa si ve el día «no apto» y ECMWF no: entonces el día queda en «dudoso». GFS solo pesa si ve el día «no apto» y los otros dos lo ven apto.
- Las ráfagas de los modelos globales salen infladas en alta montaña (hasta 10 veces el viento sostenido), por eso el umbral es 70 / 90 km/h. El domo está diseñado para 100 km/h y −15 °C.
- **Salvaguarda:** si 3 o más criterios quedan en «dudoso» el mismo día (`umbrales.acumulados`), el día pasa a «no apto».
- Veredicto:
  - **Subir:** desde mañana hay 2 días seguidos aptos.
  - **Subir con precaución:** desde mañana hay 2 días seguidos sin ningún «no apto», pero alguno con un criterio «dudoso». Revisen los motivos de cada día.
  - **Preparar la subida:** la primera ventana empieza dentro de los próximos 7 días.
  - **No subir:** no hay ventana o está demasiado lejos.

La decisión final la toma el equipo en terreno, revisando la mañana previa.

## Avalanchas (indicativo)

`docs/motor.js` estima un nivel diario de 1 a 4 (escala EAWS: débil, limitado, notable, fuerte) para el domo seleccionado, combinando los cinco problemas de avalancha del estándar europeo:

| Problema | Datos que usa |
|---|---|
| Nieve reciente | Nieve nueva en 24 y 72 h |
| Placas de viento | Viento y dirección a 700 hPa (~3.000 m) y nieve suelta de los últimos 5 días; indica las laderas de sotavento |
| Nieve húmeda | Lluvia sobre nieve, máxima sobre 0 °C con nieve reciente, alza brusca de temperatura y radiación solar (laderas N y NE) |
| Capa débil persistente | Rachas de 7 o más días fríos y sin nevar con manto delgado (historial ERA5) que luego quedan enterradas por la nieve |
| Deslizamiento basal | Manto de más de 1,5 m con varios días sobre 0 °C |

Con nivel 4 (fuerte) el día no es apto para subir; con nivel 3 (notable) queda en «dudoso». El nivel 2 (limitado) se muestra, pero no frena la subida. Los umbrales están en `avalancha` dentro de `config.json` y conviene calibrarlos con el [Boletín de Riesgos Naturales de Codelco Andina](https://deve.codelco.cl/deve/site/docs/20190417/20190417165638/bdr_diario.pdf).

**Terreno:** `scripts/satelite.py` calcula una vez, con el modelo de elevación Copernicus GLO-30, cuántas hectáreas de laderas de 30 a 50° hay sobre cada punto del sendero (`docs/sendero.json`, cada 100 m) y hacia dónde miran. El panel cruza eso con los problemas del día para indicar los tramos expuestos.

No reemplaza un boletín oficial ni la evaluación en terreno.

## Satélite (Google Earth Engine)

En cada revisión, `scripts/satelite.py` consulta Earth Engine para cada domo:

- **Sentinel-1 (radar):** compara el eco en los 15 m del domo con la mediana del entorno (50 a 150 m). Una estructura metálica en pie devuelve más eco que el terreno. El panel compara la última pasada con un período de referencia sin nieve (`satelite.referencia` en `config.json`).
- **Sentinel-2:** muestra un recorte RGB de 800 × 800 m del período de referencia y de la última imagen despejada, además de la fracción de nieve en 1 km.
- **MODIS:** índice diario de nieve del píxel de 500 m.

Para activarlo hace falta una **cuenta de servicio** de Google Cloud en el proyecto que ya usan con Earth Engine:

1. En [Google Cloud Console → IAM → Cuentas de servicio](https://console.cloud.google.com/iam-admin/serviceaccounts), creen una cuenta (por ejemplo `monitor-domos`).
2. Denle los roles **Earth Engine Resource Viewer** y **Service Usage Consumer**.
3. En la cuenta creada, vayan a **Claves → Agregar clave → JSON**. Se descarga un archivo `.json`.
4. Súbanlo como secretos del repositorio desde la Terminal (cambien la ruta y el id del proyecto):

```bash
gh secret set EE_SERVICE_ACCOUNT_KEY -R cristobalbalbi-RC/monitor-domos-el-puma < ~/Downloads/clave-monitor-domos.json
gh secret set EE_PROJECT -R cristobalbalbi-RC/monitor-domos-el-puma --body "ID-DEL-PROYECTO"
```

5. Borren el archivo `.json` del computador.

Si la organización de Google Cloud no permite crear claves, el panel lo indicará y el resto del monitor sigue funcionando igual.

## Cambiar criterios o coordenadas

Editen [`docs/config.json`](docs/config.json) directamente en GitHub (ícono del lápiz → *Commit changes*). Al guardar, la revisión vuelve a correr sola.

| Campo | Significado |
|---|---|
| `umbrales.rafaga` | `[dudoso, no apto]` en km/h |
| `umbrales.nieve72` | nieve nueva acumulada en 72 h, en cm |
| `umbrales.pp` | precipitación diaria en los domos, en mm |
| `umbrales.ppBase` | precipitación diaria en Villa Paulina (remociones en masa), en mm |
| `umbrales.lluvia` | mm de lluvia en el domo desde los que el día queda en «dudoso» (lluvia sobre nieve) |
| `umbrales.tmin` | temperatura mínima, en °C (más negativo es peor) |
| `avalancha.nivelDudoso` / `nivelNoApto` | nivel de avalancha desde el que el día queda en «dudoso» / «no apto» (3 y 4) |
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
