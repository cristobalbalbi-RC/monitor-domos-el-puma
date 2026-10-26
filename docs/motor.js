// ===== Motor de evaluación (compartido por el panel y la revisión diaria en GitHub) =====
var MOTOR_VERSION = 3;

function nivelDe(v, u, menorPeor) {
  if (v == null || !u) return null;
  if (menorPeor) return v <= u[1] ? 2 : v <= u[0] ? 1 : 0;
  return v >= u[1] ? 2 : v >= u[0] ? 1 : 0;
}
function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }

// ---------- Avalanchas (indicativo) ----------
// Niveles al estilo de la escala europea (EAWS): 1 débil, 2 limitado, 3 notable, 4 fuerte.
// Cada problema sigue la definición EAWS; los umbrales son valores de partida para calibrar.
var AVAL_DEFECTO = {
  nueva72: [10, 30, 50],          // cm de nieve nueva en 72 h para niveles 2, 3 y 4
  nueva24Notable: 30,             // cm en 24 h que por sí solos dan nivel 3
  vientoPlaca: [30, 45, 65],      // km/h de viento en altura (máx. 700/600 hPa) para niveles 2, 3 y 4
  nieveSueltaPlaca: [5, 15, 30],  // cm caídos en 5 días, disponibles para transporte, por nivel
  lluviaSobreNieve: [1, 10],      // mm de lluvia en la cota con nieve en el suelo: nivel 3 y 4
  calentamiento: 8,               // °C de alza de la máxima respecto del día anterior
  persistenteDias: 7,             // días seguidos fríos, despejados y sin nevar que forman capas débiles
  persistenteTmin: -10,           // °C mínima durante esos días
  persistenteManto: 1.5,          // m de manto: por debajo es «manto delgado»
  persistenteCarga: 20,           // cm de nieve encima que la entierran y la vuelven activa
  persistenteVigencia: 45,        // días que se considera activa después de enterrada
  deslizamientoManto: 1.5,        // m de manto para considerar deslizamiento basal
  nivelNoApto: 4,                 // desde este nivel el día no es apto para subir
  nivelDudoso: 3                  // desde este nivel el día queda en «dudoso»
};
var NIVEL_AVAL = ['', 'Débil', 'Limitado', 'Notable', 'Fuerte'];
var RUMBOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
function rumbo(g) { return g == null ? '—' : RUMBOS[Math.round(((g % 360) + 360) % 360 / 45) % 8]; }
function escalon(v, u) { if (v == null) return 1; return v >= u[2] ? 4 : v >= u[1] ? 3 : v >= u[0] ? 2 : 1; }

function serieModelo(S, k) { return (S && S[k]) || []; }
var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fcorta(ymd) { return ymd ? (+ymd.slice(8, 10)) + ' ' + MESES_CORTOS[+ymd.slice(5, 7) - 1] : ''; }

function evaluarAvalancha(pron, cfg, hoy, hist) {
  var A = {}, k;
  for (k in AVAL_DEFECTO) A[k] = AVAL_DEFECTO[k];
  if (cfg.avalancha) for (k in cfg.avalancha) A[k] = cfg.avalancha[k];
  var obj = cfg.objetivo, sitios = pron.sitios[obj] || {};
  var S = sitios.ecmwf && sitios.ecmwf.nieve ? sitios.ecmwf : (sitios.icon && sitios.icon.nieve ? sitios.icon : sitios.gfs);
  if (!S || !S.nieve) return null;
  var dias = pron.dias, idxHoy = dias.indexOf(hoy); if (idxHoy < 0) idxHoy = 0;
  var sObj = cfg.sitios.filter(function (s) { return s.id === obj; })[0];

  // Serie continua de la temporada: historial (ERA5) hasta ayer + pronóstico desde el primer día que falte.
  var H = hist && hist.sitios && hist.sitios[obj];
  var sd = [], sn = [], stmin = [], stmax = [], shs = [];
  if (H && hist.dias) hist.dias.forEach(function (d, i) {
    if (d >= dias[0]) return;
    sd.push(d); sn.push(H.nieve[i] || 0); stmin.push(H.tmin[i]); stmax.push(H.tmax ? H.tmax[i] : null); shs.push(H.nieveSuelo ? H.nieveSuelo[i] : null);
  });
  var off = sd.length;
  var ultimoManto = null; for (var q = shs.length - 1; q >= 0; q--) if (shs[q] != null) { ultimoManto = shs[q]; break; }
  dias.forEach(function (d, i) {
    sd.push(d); sn.push(S.nieve[i] || 0); stmin.push(S.tmin ? S.tmin[i] : null); stmax.push(S.tmax ? S.tmax[i] : null);
    // Manto: el pronóstico de los modelos difiere mucho; se usa el historial y se suma lo que nieva después.
    var hsMod = S.hs ? S.hs[i] : null;
    shs.push(ultimoManto != null ? null : hsMod);
  });
  // Completar el manto hacia adelante: último valor medido + nieve nueva (densidad ~ 10:1 ya está en cm de nieve).
  for (var j = 0; j < shs.length; j++) if (shs[j] == null) {
    var prev = j > 0 && shs[j - 1] != null ? shs[j - 1] : (ultimoManto != null ? ultimoManto : 0);
    var tmx = stmax[j];
    var fusion = tmx != null && tmx > 0 ? Math.min(0.05, tmx * 0.01) : 0;
    shs[j] = Math.max(0, Math.round((prev + sn[j] / 100 * 0.6 - fusion) * 100) / 100);
  }

  // Capas débiles persistentes: rachas frías, sin nevar y con manto delgado, y la nieve que luego las entierra.
  var capas = [], racha = 0;
  for (var t = 0; t < sd.length; t++) {
    var seco = (sn[t] || 0) < 1 && stmin[t] != null && stmin[t] <= A.persistenteTmin && (shs[t] == null || shs[t] < A.persistenteManto) && (shs[t] == null || shs[t] > 0.05);
    racha = seco ? racha + 1 : 0;
    if (racha === A.persistenteDias) capas.push({ formada: sd[t], idx: t, enterrada: null, carga: 0 });
  }
  capas.forEach(function (c) {
    var carga = 0;
    for (var u = c.idx + 1; u < sd.length; u++) {
      carga += sn[u] || 0;
      if (c.enterrada == null && carga >= A.persistenteCarga) { c.enterrada = sd[u]; c.idxEnt = u; break; }
    }
  });

  var out = [];
  for (var i = idxHoy; i < dias.length; i++) {
    var g = off + i, probs = [];
    var n24 = sn[g] || 0, n72 = 0, n5 = 0;
    for (var a = Math.max(0, g - 2); a <= g; a++) n72 += sn[a] || 0;
    for (var b = Math.max(0, g - 4); b <= g; b++) n5 += sn[b] || 0;
    var hs = shs[g];

    // 1. Nieve reciente
    var nN = escalon(n72, A.nueva72); if (n24 >= A.nueva24Notable) nN = Math.max(nN, 3);
    if (nN > 1) probs.push({ tipo: 'nueva', nivel: nN, texto: r1(n72) + ' cm de nieve nueva en 72 h (' + r1(n24) + ' cm en el día)' });

    // 2. Placas de viento
    var v = serieModelo(S, 'v700')[i], dv = serieModelo(S, 'd700')[i];
    if (v == null) { v = serieModelo(S, 'viento')[i]; dv = serieModelo(S, 'dir10')[i]; }
    var nV = 1;
    if (v != null) for (var L = 3; L >= 1; L--) if (v >= A.vientoPlaca[L - 1] && n5 >= A.nieveSueltaPlaca[L - 1]) { nV = L + 1; break; }
    var sota = dv == null ? null : (dv + 180) % 360;
    if (nV > 1) probs.push({ tipo: 'viento', nivel: nV, sotavento: sota, texto: 'Viento de ' + Math.round(v) + ' km/h desde el ' + rumbo(dv) + ' con ' + r1(n5) + ' cm de nieve suelta en 5 días: acumulación en laderas ' + rumbo(sota) });

    // 3. Nieve húmeda
    var lluvia = serieModelo(S, 'lluvia')[i], tmax = stmax[g], tprev = g > 0 ? stmax[g - 1] : null, rad = serieModelo(S, 'rad')[i];
    var nH = 1, motH = [];
    if (hs != null && hs > 0.1) {
      if (lluvia != null && lluvia >= A.lluviaSobreNieve[0]) { nH = lluvia >= A.lluviaSobreNieve[1] ? 4 : 3; motH.push(r1(lluvia) + ' mm de lluvia sobre la nieve'); }
      if (tmax != null && tmax >= 0 && n72 >= 10) { nH = Math.max(nH, tmax >= 3 && n72 >= 20 ? 3 : 2); motH.push('máxima de ' + r1(tmax) + ' °C sobre nieve reciente'); }
      if (tmax != null && tprev != null && tmax - tprev >= A.calentamiento && tmax > -3) { nH = Math.max(nH, 2); motH.push('alza de ' + r1(tmax - tprev) + ' °C en 24 h'); }
    }
    if (nH > 1) probs.push({ tipo: 'humeda', nivel: nH, asoleadas: rad != null && rad >= 20, texto: motH.join('; ') + (rad != null && rad >= 20 ? '. Más probable en laderas N y NE, de mediodía a la tarde' : '') });

    // 4. Capas débiles persistentes
    var activa = null;
    capas.forEach(function (c) { if (c.enterrada && c.idxEnt <= g && g - c.idxEnt <= A.persistenteVigencia) activa = c; });
    if (activa) {
      var nP = n72 >= 20 ? 3 : 2;
      probs.push({ tipo: 'persistente', nivel: nP, texto: 'Capa débil posible: racha fría y sin nevar hasta el ' + fcorta(activa.formada) + ', enterrada por nieve desde el ' + fcorta(activa.enterrada) + (n72 >= 20 ? '; la nieve nueva le agrega carga' : '') });
    }

    // 5. Deslizamiento basal
    var calidos = 0; for (var w = Math.max(0, g - 4); w <= g; w++) if (stmax[w] != null && stmax[w] > 0) calidos++;
    if (hs != null && hs >= A.deslizamientoManto && calidos >= 3) probs.push({ tipo: 'deslizamiento', nivel: 2, texto: 'Manto de ' + r1(hs) + ' m con ' + calidos + ' de los últimos 5 días sobre 0 °C' });

    var nivel = 1; probs.forEach(function (p) { nivel = Math.max(nivel, p.nivel); });
    var notables = probs.filter(function (p) { return p.nivel >= 3; }).length;
    if (notables >= 2 && nivel < 4) nivel++;
    probs.sort(function (x, y) { return y.nivel - x.nivel; });
    out.push({ f: dias[i], nivel: nivel, problemas: probs, n24: r1(n24), n72: r1(n72), v700: v == null ? null : Math.round(v), d700: dv, sotavento: sota, hs: hs, lluvia: r1(lluvia), tmax: r1(tmax) });
  }
  return { umbrales: A, elev: sObj ? sObj.elev : null, dias: out };
}

function evaluar(pron, cfg, hoy, hist) {
  var U = cfg.umbrales, obj = cfg.objetivo, N = cfg.ventanaDias || 2;
  var sObj = cfg.sitios.filter(function (s) { return s.id === obj; })[0];
  // Precipitación en la cota de los domos (hasta el destino) y, aparte, en la base para remociones en masa.
  var domosRuta = cfg.sitios.filter(function (s) { return s.domo && s.elev <= sObj.elev; }).map(function (s) { return s.id; });
  var baseId = (cfg.sitios.filter(function (s) { return !s.domo; })[0] || {}).id;
  var dias = pron.dias;
  var aval = evaluarAvalancha(pron, cfg, hoy, hist);
  var avalPorDia = {}; if (aval) aval.dias.forEach(function (d) { avalPorDia[d.f] = d; });
  var AU = aval ? aval.umbrales : AVAL_DEFECTO;
  var umbLluvia = U.lluvia != null ? U.lluvia : 2;
  function serie(id, m, k, i) { var S = pron.sitios[id] && pron.sitios[id][m]; return S && S[k] ? S[k][i] : null; }
  function evalModelo(m, i) {
    var S = pron.sitios[obj] && pron.sitios[obj][m];
    if (!S || !S.rafaga || S.rafaga[i] == null) return null;
    var g = S.rafaga[i], n72 = 0;
    for (var k = Math.max(0, i - 2); k <= i; k++) n72 += (S.nieve && S.nieve[k]) || 0;
    var tmin = S.tmin ? S.tmin[i] : null, pp = 0;
    domosRuta.forEach(function (id) { var v = serie(id, m, 'pp', i); if (v != null) pp = Math.max(pp, v); });
    var ppBase = baseId ? serie(baseId, m, 'pp', i) : null;
    var lluvia = S.lluvia ? S.lluvia[i] : null;
    var c = [['rafaga', g, nivelDe(g, U.rafaga)], ['nieve72', n72, nivelDe(n72, U.nieve72)],
             ['pp', pp, nivelDe(pp, U.pp)], ['tmin', tmin, nivelDe(tmin, U.tmin, true)],
             ['ppBase', ppBase, nivelDe(ppBase, U.ppBase || [15, 25])],
             ['lluvia', lluvia, lluvia != null && lluvia >= umbLluvia ? 1 : 0]];
    var n = 0, mot = [];
    c.forEach(function (x) { if (x[2] != null) { n = Math.max(n, x[2]); if (x[2] > 0) mot.push(x[0]); } });
    return { n: n, g: r1(g), n72: r1(n72), tmin: r1(tmin), pp: r1(pp), ppBase: r1(ppBase), lluvia: r1(lluvia), mot: mot };
  }
  var out = [], idxHoy = dias.indexOf(hoy);
  if (idxHoy < 0) idxHoy = 0;
  for (var i = idxHoy; i < dias.length; i++) {
    var E = evalModelo('ecmwf', i), I = evalModelo('icon', i), G = evalModelo('gfs', i);
    var base = E || I || G; if (!base) continue;
    var n = base.n, notas = [];
    // ECMWF decide. ICON, como segunda opinión, solo pesa si ve un día «no apto»: lo deja en «dudoso».
    // GFS se muestra como referencia, pero no cambia el nivel del día (solo se usa si faltan ECMWF e ICON).
    if (E && I && I.n === 2 && E.n < 2) { n = Math.max(n, 1); if (n > E.n) notas.push('ICON ve el día no apto'); }
    var iso = null;
    ['icon', 'gfs', 'ecmwf'].forEach(function (m) {
      var a = pron.isoterma && pron.isoterma[m]; if (a && a[i] != null) iso = iso == null ? a[i] : Math.max(iso, a[i]);
    });
    var av = avalPorDia[dias[i]];
    if (av && av.nivel >= AU.nivelNoApto) { n = 2; notas.push('avalancha'); }
    else if (av && av.nivel >= AU.nivelDudoso) { n = Math.max(n, 1); notas.push('avalancha'); }
    // Salvaguarda: varios criterios en «dudoso» el mismo día (p. ej. viento, nieve nueva y avalancha) suman un día no apto.
    var crit = base.mot.concat(notas.filter(function (x) { return x === 'avalancha'; }));
    if (n === 1 && crit.length >= (U.acumulados || 3)) { n = 2; notas.push('acumulados'); }
    var ahead = i - idxHoy;
    out.push({ f: dias[i], n: n, c: ahead <= 3 ? 'alta' : ahead <= 7 ? 'media' : 'baja',
      nm: [E ? E.n : null, I ? I.n : null, G ? G.n : null],
      raf: [E ? E.g : null, I ? I.g : null, G ? G.g : null],
      mods: [E, I, G].map(function (x) { return x ? { n: x.n, g: x.g, pp: x.pp, n72: x.n72, tmin: x.tmin, lluvia: x.lluvia, ppBase: x.ppBase, mot: x.mot } : null; }),
      n72: base.n72, tmin: base.tmin, pp: base.pp, ppBase: base.ppBase, lluvia: base.lluvia, iso: iso,
      aval: av ? av.nivel : null, mot: base.mot.concat(notas) });
  }
  function buscar(maxN) {
    for (var a = 1; a + N - 1 < out.length; a++) {
      var ok = true;
      for (var b = a; b < a + N; b++) if (out[b].n > maxN) { ok = false; break; }
      if (ok) return { inicio: out[a].f, fin: out[a + N - 1].f, enDias: a, estricta: maxN === 0 };
    }
    return null;
  }
  // Ventana plena: N días aptos. Ventana con precaución: N días sin ningún «no apto».
  var plena = buscar(0), prec = buscar(1);
  var ventana = plena && (!prec || plena.enDias <= prec.enDias) ? plena : prec;
  var v;
  if (ventana && ventana.estricta && ventana.enDias === 1) v = { estado: 'verde', titulo: 'Subir', detalle: 'Hay ' + N + ' días seguidos aptos desde mañana. Confirmen la decisión mañana temprano.' };
  else if (ventana && !ventana.estricta && ventana.enDias === 1) v = { estado: 'amarillo', titulo: 'Subir con precaución', detalle: 'Desde mañana hay ' + N + ' días sin condiciones «no apto», pero con algún criterio en «dudoso». Revisen los motivos de cada día antes de decidir.' + (plena ? ' Los primeros ' + N + ' días plenamente aptos parten el ' + fcorta(plena.inicio) + '.' : '') };
  else if (ventana && ventana.enDias <= 7) v = { estado: 'amarillo', titulo: 'Preparar la subida', detalle: 'Primera ventana' + (ventana.estricta ? ' de ' + N + ' días aptos' : ' de ' + N + ' días sin «no apto»') + ' en ' + ventana.enDias + ' días. Revisen a diario: se confirma la mañana previa.' };
  else if (ventana) v = { estado: 'rojo', titulo: 'No subir por ahora', detalle: 'La primera ventana aparece recién en ' + ventana.enDias + ' días, con pronóstico de baja confianza.' };
  else v = { estado: 'rojo', titulo: 'No subir', detalle: 'No hay ' + N + ' días seguidos sin condiciones «no apto» en los próximos ' + (out.length - 1) + ' días.' };
  return { motor: MOTOR_VERSION, fecha: hoy, objetivo: obj, umbrales: U, ventanaDias: N, veredicto: v, ventana: ventana, dias: out, avalancha: aval };
}
