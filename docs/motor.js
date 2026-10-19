// ===== Motor de evaluación (compartido por el panel y la tarea diaria) =====
var MOTOR_VERSION = 1;

function nivelDe(v, u, menorPeor) {
  if (v == null || !u) return null;
  if (menorPeor) return v <= u[1] ? 2 : v <= u[0] ? 1 : 0;
  return v >= u[1] ? 2 : v >= u[0] ? 1 : 0;
}
function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
function evaluar(pron, cfg, hoy) {
  var U = cfg.umbrales, obj = cfg.objetivo, N = cfg.ventanaDias || 2;
  var sObj = cfg.sitios.filter(function (s) { return s.id === obj; })[0];
  var ruta = cfg.sitios.filter(function (s) { return s.elev <= sObj.elev; }).map(function (s) { return s.id; });
  var dias = pron.dias;
  function evalModelo(m, i) {
    var S = pron.sitios[obj] && pron.sitios[obj][m];
    if (!S || !S.rafaga || S.rafaga[i] == null) return null;
    var g = S.rafaga[i], n72 = 0;
    for (var k = Math.max(0, i - 2); k <= i; k++) n72 += (S.nieve && S.nieve[k]) || 0;
    var tmin = S.tmin ? S.tmin[i] : null, pp = 0;
    ruta.forEach(function (id) {
      var v = pron.sitios[id] && pron.sitios[id][m] && pron.sitios[id][m].pp ? pron.sitios[id][m].pp[i] : null;
      if (v != null) pp = Math.max(pp, v);
    });
    var c = [['rafaga', g, nivelDe(g, U.rafaga)], ['nieve72', n72, nivelDe(n72, U.nieve72)],
             ['pp', pp, nivelDe(pp, U.pp)], ['tmin', tmin, nivelDe(tmin, U.tmin, true)]];
    var n = 0, mot = [];
    c.forEach(function (x) { if (x[2] != null) { n = Math.max(n, x[2]); if (x[2] > 0) mot.push(x[0]); } });
    return { n: n, g: r1(g), n72: r1(n72), tmin: r1(tmin), pp: r1(pp), mot: mot };
  }
  var out = [], idxHoy = dias.indexOf(hoy);
  if (idxHoy < 0) idxHoy = 0;
  for (var i = idxHoy; i < dias.length; i++) {
    var E = evalModelo('ecmwf', i), I = evalModelo('icon', i), G = evalModelo('gfs', i);
    var base = E || I || G; if (!base) continue;
    var n = base.n, notas = [];
    if (E && I && I.n > E.n) { n = Math.min(2, n + 1); notas.push('ICON más severo que ECMWF'); }
    if (G && G.n > n && n < 1) { n = 1; notas.push('Solo GFS marca riesgo'); }
    var iso = null;
    ['icon', 'gfs', 'ecmwf'].forEach(function (m) {
      var a = pron.isoterma && pron.isoterma[m]; if (a && a[i] != null) iso = iso == null ? a[i] : Math.max(iso, a[i]);
    });
    if (iso != null && base.pp >= 2 && iso > sObj.elev) { n = Math.max(n, 1); notas.push('lluvia'); }
    var ahead = i - idxHoy;
    out.push({ f: dias[i], n: n, c: ahead <= 3 ? 'alta' : ahead <= 7 ? 'media' : 'baja',
      nm: [E ? E.n : null, I ? I.n : null, G ? G.n : null],
      raf: [E ? E.g : null, I ? I.g : null, G ? G.g : null],
      n72: base.n72, tmin: base.tmin, pp: base.pp, iso: iso, mot: base.mot.concat(notas) });
  }
  var ventana = null;
  for (var a = 1; a + N - 1 < out.length; a++) {
    var ok = true;
    for (var b = a; b < a + N; b++) if (out[b].n !== 0) { ok = false; break; }
    if (ok) { ventana = { inicio: out[a].f, fin: out[a + N - 1].f, enDias: a }; break; }
  }
  var v;
  if (ventana && ventana.enDias === 1) v = { estado: 'verde', titulo: 'Subir', detalle: 'Hay ' + N + ' días seguidos aptos desde mañana. Confirmen la decisión mañana temprano.' };
  else if (ventana && ventana.enDias <= 7) v = { estado: 'amarillo', titulo: 'Preparar la subida', detalle: 'Primera ventana de ' + N + ' días aptos en ' + ventana.enDias + ' días. Revisen a diario: se confirma la mañana previa.' };
  else if (ventana) v = { estado: 'rojo', titulo: 'No subir por ahora', detalle: 'La primera ventana aparece recién en ' + ventana.enDias + ' días, con pronóstico de baja confianza.' };
  else v = { estado: 'rojo', titulo: 'No subir', detalle: 'No hay ' + N + ' días seguidos aptos en los próximos ' + (out.length - 1) + ' días.' };
  return { motor: MOTOR_VERSION, fecha: hoy, objetivo: obj, umbrales: U, ventanaDias: N, veredicto: v, ventana: ventana, dias: out };
}
