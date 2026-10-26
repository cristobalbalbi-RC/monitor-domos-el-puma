// Revisión diaria de los domos del Sendero El Puma.
// Descarga pronóstico (ECMWF, ICON, GFS) e historial (ERA5) desde Open-Meteo,
// evalúa con docs/motor.js (el mismo motor que usa el panel) y escribe docs/data/.
// Uso: node scripts/revision.mjs            (en GitHub Actions)
//      OFFLINE=fixtures/ node scripts/revision.mjs   (pruebas sin red)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DOCS = path.join(RAIZ, 'docs');
const DATA = path.join(DOCS, 'data');
const OFFLINE = process.env.OFFLINE || '';

vm.runInThisContext(fs.readFileSync(path.join(DOCS, 'motor.js'), 'utf8'), { filename: 'motor.js' });
const evaluar = globalThis.evaluar;

const cfg = JSON.parse(fs.readFileSync(path.join(DOCS, 'config.json'), 'utf8'));
const hoy = process.env.HOY || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const M = { ecmwf: 'ecmwf_ifs025', icon: 'icon_seamless', gfs: 'gfs_seamless' };
const DV = { tmin: 'temperature_2m_min', tmax: 'temperature_2m_max', pp: 'precipitation_sum', nieve: 'snowfall_sum', viento: 'wind_speed_10m_max', rafaga: 'wind_gusts_10m_max', wcode: 'weather_code',
  lluvia: 'rain_sum', rad: 'shortwave_radiation_sum', dir10: 'wind_direction_10m_dominant' };

async function getJSON(url, nombre) {
  if (OFFLINE) return JSON.parse(fs.readFileSync(path.join(OFFLINE, nombre + '.json'), 'utf8'));
  let ultimo;
  for (let intento = 1; intento <= 4; intento++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'monitor-domos-el-puma (GitHub Actions)' } });
      if (!r.ok) {
        const cuerpo = (await r.text()).slice(0, 200);
        const e = new Error(`HTTP ${r.status}: ${cuerpo}`);
        // El límite diario de Open-Meteo es por IP: reintentar en este mismo servidor no sirve.
        if (r.status === 429 && /daily/i.test(cuerpo)) { e.definitivo = true; }
        throw e;
      }
      return await r.json();
    } catch (e) {
      ultimo = e;
      if (e.definitivo) { console.warn(`${nombre}: límite diario de Open-Meteo para la IP de este servidor; el reintento programado usará otro.`); break; }
      console.warn(`Intento ${intento} falló para ${nombre}: ${e.message}`);
      await new Promise(res => setTimeout(res, 5000 * intento));
    }
  }
  throw ultimo;
}
const lista = j => (Array.isArray(j) ? j : [j]);
const coords = sitios => ({
  lat: sitios.map(s => s.lat).join(','), lon: sitios.map(s => s.lon).join(','), el: sitios.map(s => s.elev).join(',')
});

async function pronostico() {
  const c = coords(cfg.sitios);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&elevation=${c.el}` +
    `&daily=${Object.values(DV).join(',')}&hourly=freezing_level_height,wind_speed_700hPa,wind_direction_700hPa,wind_speed_600hPa,wind_direction_600hPa,snow_depth&models=${Object.values(M).join(',')}` +
    `&timezone=America%2FSantiago&past_days=5&forecast_days=14`;
  const f = lista(await getJSON(url, 'pronostico'));
  const pron = { dias: f[0].daily.time, sitios: {}, isoterma: {} };
  f.forEach((loc, i) => {
    const o = {};
    for (const [mk, mv] of Object.entries(M)) {
      o[mk] = {};
      for (const [k, v] of Object.entries(DV)) o[mk][k] = loc.daily[v + '_' + mv] || null;
      // Agregados diarios de variables horarias: viento a 700 hPa (~3.000 m) y nieve en el suelo.
      const hh = loc.hourly || {}, sd = hh['snow_depth_' + mv] || [];
      // Viento libre en altura: máximo entre 700 hPa (~3.000 m) y 600 hPa (~4.200 m), que encierran la cota de los domos.
      const niveles = [['700hPa'], ['600hPa']].map(([n]) => [hh['wind_speed_' + n + '_' + mv] || [], hh['wind_direction_' + n + '_' + mv] || []]);
      o[mk].v700 = []; o[mk].d700 = []; o[mk].hs = [];
      f[0].daily.time.forEach(d => {
        let vmax = null, dmax = null, hmax = null;
        (hh.time || []).forEach((t, k) => {
          if (!t.startsWith(d)) return;
          niveles.forEach(([ws, wd]) => { if (ws[k] != null && (vmax == null || ws[k] > vmax)) { vmax = ws[k]; dmax = wd[k]; } });
          if (sd[k] != null && (hmax == null || sd[k] > hmax)) hmax = sd[k];
        });
        o[mk].v700.push(vmax == null ? null : Math.round(vmax));
        o[mk].d700.push(dmax == null ? null : Math.round(dmax));
        o[mk].hs.push(hmax == null ? null : Math.round(hmax * 100) / 100);
      });
    }
    pron.sitios[cfg.sitios[i].id] = o;
  });
  const h = f[f.length - 1].hourly;
  for (const [mk, mv] of Object.entries(M)) {
    const a = h['freezing_level_height_' + mv] || [];
    pron.isoterma[mk] = pron.dias.map(d => {
      let mx = null;
      h.time.forEach((t, k) => { if (t.startsWith(d) && a[k] != null) mx = mx == null ? a[k] : Math.max(mx, a[k]); });
      return mx;
    });
  }
  return pron;
}

async function historico(desde, hasta) {
  const c = coords(cfg.sitios);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${c.lat}&longitude=${c.lon}&elevation=${c.el}` +
    `&start_date=${desde}&end_date=${hasta}&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,snowfall_sum,wind_gusts_10m_max` +
    `&hourly=snow_depth&timezone=America%2FSantiago`;
  const a = lista(await getJSON(url, 'historico'));
  const hist = { dias: a[0].daily.time, sitios: {} };
  a.forEach((loc, i) => {
    const sd = loc.hourly.snow_depth || [];
    const dm = hist.dias.map((d, k) => {
      let mx = null;
      for (let q = k * 24; q < k * 24 + 24; q++) { const v = sd[q]; if (v != null) mx = mx == null ? v : Math.max(mx, v); }
      return mx == null ? null : Math.round(mx * 100) / 100;
    });
    hist.sitios[cfg.sitios[i].id] = {
      rafaga: loc.daily.wind_gusts_10m_max, tmin: loc.daily.temperature_2m_min, tmax: loc.daily.temperature_2m_max,
      nieve: loc.daily.snowfall_sum, pp: loc.daily.precipitation_sum, nieveSuelo: dm
    };
  });
  return hist;
}

async function climatologia(s) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${s.lat}&longitude=${s.lon}&elevation=${s.elev}` +
    `&start_date=2016-01-01&end_date=2025-12-31&daily=temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max&timezone=America%2FSantiago`;
  const d = (await getJSON(url, 'clima-' + s.id)).daily;
  const q = (a, f) => a.map(v => (v == null ? null : Math.round(v * f) / f));
  return { sitio: s.id, lat: s.lat, lon: s.lon, elev: s.elev, inicio: d.time[0], fin: d.time[d.time.length - 1],
    generado: new Date().toISOString(), raf: q(d.wind_gusts_10m_max, 1), nieve: q(d.snowfall_sum, 10),
    pp: q(d.precipitation_sum, 10), tmin: q(d.temperature_2m_min, 10) };
}

const leer = (p, def) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } };
const escribir = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj) + '\n'); };
const fmt = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const n0 = v => (v == null ? '—' : Math.round(v).toString());

async function main() {
  const generado = new Date().toISOString();
  const pron = await pronostico();
  const hasta = addDays(hoy, -1);
  const desde = cfg.desde < hasta ? cfg.desde : addDays(hasta, -30);
  const hist = await historico(desde, hasta);

  const rev = evaluar(pron, cfg, hoy, hist);
  rev.generado = generado;
  rev.origen = 'github';

  escribir(path.join(DATA, 'actual.json'), {
    hoy, generado, desde,
    sitios: cfg.sitios.map(s => ({ id: s.id, lat: s.lat, lon: s.lon, elev: s.elev })),
    pronostico: pron, historico: hist, revision: rev
  });
  escribir(path.join(DATA, 'revisiones', hoy + '.json'), rev);

  const bitPath = path.join(DATA, 'bitacora.json');
  const bit = leer(bitPath, []).filter(r => r.fecha !== hoy);
  const previo = bit.filter(r => r.objetivo === rev.objetivo).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0] || null;
  bit.push({ fecha: hoy, objetivo: rev.objetivo, veredicto: { estado: rev.veredicto.estado, titulo: rev.veredicto.titulo },
    ventana: rev.ventana, generado, origen: 'github' });
  bit.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  escribir(bitPath, bit.slice(0, 180));

  // Climatología 2016-2025: se calcula una vez por domo (o si cambian sus coordenadas).
  for (const s of cfg.sitios.filter(x => x.domo)) {
    const p = path.join(DATA, 'clima-' + s.id + '.json');
    const c = leer(p, null);
    if (!c || c.lat !== s.lat || c.lon !== s.lon || c.elev !== s.elev) {
      try { escribir(p, await climatologia(s)); console.log('Climatología calculada para', s.id); }
      catch (e) { console.warn('No se pudo calcular la climatología de', s.id, e.message); }
    }
  }

  // ¿Avisar?
  const cambio = !previo || previo.veredicto.estado !== rev.veredicto.estado ||
    (rev.veredicto.estado !== 'rojo' && (previo.ventana && previo.ventana.inicio) !== (rev.ventana && rev.ventana.inicio));
  const avisar = cfg.aviso === 'diario' || cambio || process.env.FORZAR_AVISO === 'true';
  const s = cfg.sitios.find(x => x.id === rev.objetivo);
  const MOT = { rafaga: 'ráfagas', nieve72: 'nieve 72 h', pp: 'precipitación en los domos', ppBase: 'lluvia en Villa Paulina',
    tmin: 'frío', lluvia: 'lluvia sobre nieve', avalancha: 'avalancha', acumulados: 'varios criterios a la vez', 'ICON ve el día no apto': 'ICON lo ve no apto', 'Solo GFS ve el día no apto': 'GFS lo ve no apto' };
  const lineas = rev.dias.slice(0, 3).map(d =>
    `- ${fmt(d.f)}: **${['Apto', 'Dudoso', 'No apto'][d.n]}** · ráfaga ${n0(d.raf[0] ?? d.raf[1])} km/h · nieve 72 h ${n0(d.n72)} cm · mínima ${n0(d.tmin)} °C` +
    (d.n > 0 && d.mot.length ? ` · por ${d.mot.map(k => MOT[k] || k).join(', ')}` : ''));
  const NIV = ['', 'débil', 'limitado', 'notable', 'fuerte'];
  const PROB = { nueva: 'nieve reciente', viento: 'placas de viento', humeda: 'nieve húmeda', persistente: 'capa débil persistente', deslizamiento: 'deslizamiento basal' };
  const avalLineas = rev.avalancha ? ['', '### Avalanchas (indicativo, no oficial)', ...rev.avalancha.dias.slice(0, 3).map(d =>
    `- ${fmt(d.f)}: nivel ${d.nivel} (${NIV[d.nivel]})` + (d.problemas.length ? ' · ' + d.problemas.map(p => PROB[p.tipo]).join(', ') : ''))] : [];
  const prefijo = rev.veredicto.estado === 'rojo' ? '' : 'ATENCIÓN: ';
  const asunto = `${prefijo}${rev.veredicto.titulo} · ${s.corto} · ${hoy}`;
  const panel = process.env.PANEL_URL || '';
  const cuerpo = [
    `## ${rev.veredicto.titulo}`,
    '',
    rev.veredicto.detalle,
    rev.ventana ? `\n**Ventana:** ${fmt(rev.ventana.inicio)} al ${fmt(rev.ventana.fin)}` : '',
    previo ? `\nVeredicto anterior (${previo.fecha}): ${previo.veredicto.titulo}.` : '',
    '',
    `### Próximos días en ${s.nombre} (${s.elev} m)`,
    ...lineas,
    ...avalLineas,
    '',
    panel ? `Panel: ${panel}` : '',
    '',
    '_Generado automáticamente por GitHub Actions con datos de Open-Meteo (ECMWF, ICON, GFS). La decisión final la toma el equipo en terreno._'
  ].join('\n');

  console.log(`Veredicto ${hoy}: ${rev.veredicto.titulo} (${rev.veredicto.estado}); ventana: ${rev.ventana ? rev.ventana.inicio + '→' + rev.ventana.fin : 'ninguna'}; avisar: ${avisar}`);
  const out = process.env.GITHUB_OUTPUT;
  const tmp = process.env.RUNNER_TEMP || '/tmp';
  fs.writeFileSync(path.join(tmp, 'aviso.md'), cuerpo);
  if (out) {
    fs.appendFileSync(out, `aviso=${avisar}\nasunto=${asunto.replace(/\n/g, ' ')}\ncuerpo=${path.join(tmp, 'aviso.md')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, cuerpo + '\n');
}

main().catch(e => { console.error('La revisión falló:', e); process.exit(1); });
