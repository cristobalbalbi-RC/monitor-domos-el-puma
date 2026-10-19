"""Revisión satelital de los domos con Google Earth Engine.

Escribe docs/data/satelite.json y recortes PNG de Sentinel-2 en docs/data/.
Nunca hace fallar la revisión diaria: si algo sale mal, deja el error en el JSON
para que el panel lo muestre.

Secretos (GitHub → Settings → Secrets and variables → Actions):
  EE_SERVICE_ACCOUNT_KEY  contenido del archivo JSON de la cuenta de servicio
  EE_PROJECT              id del proyecto de Google Cloud registrado en Earth Engine
"""
import datetime as dt
import json
import os
import pathlib
import traceback
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DOCS = RAIZ / "docs"
DATA = DOCS / "data"
SALIDA = DATA / "satelite.json"

cfg = json.loads((DOCS / "config.json").read_text(encoding="utf-8"))
sat = cfg.get("satelite", {})
DESDE = sat.get("desde", "2025-10-01")
REF = sat.get("referencia", ["2026-02-01", "2026-04-30"])
HOY = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date()
MANANA = (HOY + dt.timedelta(days=1)).isoformat()


def escribir(obj):
    DATA.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(obj, ensure_ascii=False) + "\n", encoding="utf-8")


def iniciar():
    clave = os.environ.get("EE_SERVICE_ACCOUNT_KEY", "").strip()
    if not clave:
        raise RuntimeError("pendiente: falta el secreto EE_SERVICE_ACCOUNT_KEY en el repositorio")
    import ee

    info = json.loads(clave)
    cred = ee.ServiceAccountCredentials(info["client_email"], key_data=clave)
    ee.Initialize(cred, project=os.environ.get("EE_PROJECT") or info.get("project_id"))
    return ee


def radar(ee, p):
    """Sentinel-1: brillo máximo en 15 m alrededor del domo vs. mediana del entorno (50-150 m)."""
    nucleo = p.buffer(15)
    anillo = p.buffer(150).difference(p.buffer(50))
    col = (ee.ImageCollection("COPERNICUS/S1_GRD")
           .filterBounds(p).filterDate(DESDE, MANANA)
           .filter(ee.Filter.eq("instrumentMode", "IW"))
           .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV")))

    def f(img):
        vv = img.select("VV")
        c = vv.reduceRegion(ee.Reducer.max(), nucleo, 10).get("VV")
        b = vv.reduceRegion(ee.Reducer.median(), anillo, 10).get("VV")
        return ee.Feature(None, {
            "t": img.date().format("YYYY-MM-dd"), "orb": img.get("relativeOrbitNumber_start"),
            "pass": img.get("orbitProperties_pass"), "sat": img.get("platform_number"), "vv": c, "bg": b})

    fc = ee.FeatureCollection(col.map(f)).filter(ee.Filter.notNull(["vv", "bg"]))
    filas = fc.reduceColumns(ee.Reducer.toList(6), ["t", "orb", "pass", "sat", "vv", "bg"]).get("list").getInfo()
    filas = [[t, int(o), ps, s, round(v, 2), round(b, 2)] for t, o, ps, s, v, b in filas]
    filas.sort(key=lambda r: r[0])
    return filas


def optico(ee, p):
    """Sentinel-2: nubes en 300 m y nieve en 1 km alrededor del domo, para cada pasada."""
    caja = p.buffer(300)
    entorno = p.buffer(1000)
    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterBounds(p).filterDate(DESDE, MANANA))

    def f(img):
        scl = img.select("SCL")
        nube = scl.eq(3).Or(scl.eq(8)).Or(scl.eq(9)).Or(scl.eq(10))
        n = nube.reduceRegion(ee.Reducer.mean(), caja, 20).get("SCL")
        s = scl.eq(11).reduceRegion(ee.Reducer.mean(), entorno, 20).get("SCL")
        return img.set({"nube": n, "nieve": s, "t": img.date().format("YYYY-MM-dd")})

    col = col.map(f).filter(ee.Filter.notNull(["nube", "nieve"]))
    filas = col.reduceColumns(ee.Reducer.toList(3), ["t", "nube", "nieve"]).get("list").getInfo()
    # Una fila por día (pueden coincidir dos granulos).
    por_dia = {}
    for t, n, s in filas:
        if t not in por_dia or n < por_dia[t][1]:
            por_dia[t] = [t, round(n, 3), round(s, 3)]
    return col, sorted(por_dia.values())


def recorte(ee, col, p, desde, hasta, nombre):
    """PNG RGB de 800 x 800 m centrado en el domo, de la imagen despejada más reciente del período."""
    sub = col.filterDate(desde, hasta).filter(ee.Filter.lt("nube", 0.15)).sort("system:time_start", False)
    if sub.size().getInfo() == 0:
        return None
    img = ee.Image(sub.first())
    fecha = img.date().format("YYYY-MM-dd").getInfo()
    url = (img.visualize(bands=["B4", "B3", "B2"], min=0, max=9000, gamma=1.3)
           .getThumbURL({"region": p.buffer(400).bounds(), "dimensions": 512, "format": "png"}))
    archivo = f"{nombre}.png"
    with urllib.request.urlopen(url, timeout=120) as r:
        (DATA / archivo).write_bytes(r.read())
    return {"fecha": fecha, "archivo": archivo}


def nieve_modis(ee, p):
    """MODIS Terra: NDSI de cobertura de nieve (0-100) del píxel de 500 m del domo, último año."""
    inicio = (HOY - dt.timedelta(days=365)).isoformat()
    col = (ee.ImageCollection("MODIS/061/MOD10A1").filterDate(inicio, MANANA).select("NDSI_Snow_Cover"))

    def f(img):
        v = img.reduceRegion(ee.Reducer.first(), p, 500).get("NDSI_Snow_Cover")
        return ee.Feature(None, {"t": img.date().format("YYYY-MM-dd"), "v": v})

    fc = ee.FeatureCollection(col.map(f)).filter(ee.Filter.notNull(["v"]))
    filas = fc.reduceColumns(ee.Reducer.toList(2), ["t", "v"]).get("list").getInfo()
    return sorted([[t, int(v)] for t, v in filas if v is not None and v <= 100])


def terreno(ee):
    """Exposición del sendero a avalanchas: zonas de inicio (laderas de 30 a 50°) sobre cada punto del trazado.

    Se calcula una sola vez (o si cambia el trazado) con el modelo de elevación Copernicus GLO-30.
    """
    import hashlib
    ruta = DOCS / "sendero.json"
    if not ruta.exists():
        return
    texto = ruta.read_text(encoding="utf-8")
    firma = hashlib.sha1(texto.encode()).hexdigest()[:12]
    destino = DATA / "terreno.json"
    if destino.exists():
        try:
            if json.loads(destino.read_text(encoding="utf-8")).get("firma") == firma:
                return
        except Exception:  # noqa: BLE001
            pass
    sendero = json.loads(texto)
    pts = sendero["puntos"]
    radio = 500
    fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([lon, lat]), {"km": km}) for lon, lat, km in pts])
    region = fc.geometry().buffer(radio + 200).bounds()
    col = ee.ImageCollection("COPERNICUS/DEM/GLO30").filterBounds(region).select("DEM")
    dem = col.mosaic().setDefaultProjection(col.first().projection()).rename("elev")
    prod = ee.Terrain.products(dem)
    pend = prod.select("slope")
    asp = prod.select("aspect").multiply(3.141592653589793 / 180)
    inicio = pend.gte(30).And(pend.lte(50))
    con_elev = dem.reduceRegions(fc, ee.Reducer.first(), 30)

    def f(ft):
        p = ft.geometry()
        e = ee.Number(ft.get("first"))
        zona = p.buffer(radio)
        m = inicio.And(dem.gt(e.add(30)))
        area = ee.Image.pixelArea().rename("a").updateMask(m).reduceRegion(ee.Reducer.sum(), zona, 30).get("a")
        sc = ee.Image.cat(asp.sin().rename("s"), asp.cos().rename("c")).updateMask(m).reduceRegion(ee.Reducer.mean(), zona, 30)
        loc = pend.reduceRegion(ee.Reducer.max(), p.buffer(30), 30).get("slope")
        return ee.Feature(None, {"km": ft.get("km"), "elev": e, "area": area, "s": sc.get("s"), "c": sc.get("c"), "pend": loc})

    filas = (ee.FeatureCollection(con_elev.map(f))
             .reduceColumns(ee.Reducer.toList(6), ["km", "elev", "area", "s", "c", "pend"]).get("list").getInfo())
    import math
    salida = []
    for km, e, a, sn, cs, pl in filas:
        orient = None if sn is None or cs is None else round((math.degrees(math.atan2(sn, cs)) + 360) % 360)
        salida.append([km, None if e is None else round(e), round((a or 0) / 10000, 1), orient, None if pl is None else round(pl)])
    salida.sort(key=lambda r: r[0])
    destino.write_text(json.dumps({
        "generado": dt.datetime.now(dt.timezone.utc).isoformat(), "firma": firma, "radio_m": radio,
        "metodo": "Copernicus GLO-30; zonas de inicio = pendiente 30-50° y al menos 30 m sobre el punto, en un radio de 500 m",
        "columnas": ["km", "elev_m", "zonas_inicio_ha", "orientacion_grados", "pendiente_local_max"],
        "puntos": salida}, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Terreno: {len(salida)} puntos del sendero analizados")


def main():
    salida = {"generado": dt.datetime.now(dt.timezone.utc).isoformat(), "desde": DESDE,
              "referencia": REF, "sitios": {}, "errores": []}
    try:
        ee = iniciar()
    except Exception as e:  # noqa: BLE001
        salida["error"] = str(e)
        escribir(salida)
        print("Satélite:", e)
        return
    for s in [x for x in cfg["sitios"] if x.get("domo")]:
        p = ee.Geometry.Point([s["lon"], s["lat"]])
        r = {"lat": s["lat"], "lon": s["lon"]}
        try:
            r["s1"] = radar(ee, p)
        except Exception as e:  # noqa: BLE001
            salida["errores"].append(f"{s['id']} radar: {e}")
        try:
            col, r["s2"] = optico(ee, p)
            r["chips"] = {
                "referencia": recorte(ee, col, p, REF[0], REF[1], f"s2-{s['id']}-referencia"),
                "ultima": recorte(ee, col, p, (HOY - dt.timedelta(days=120)).isoformat(), MANANA, f"s2-{s['id']}-ultima"),
            }
        except Exception as e:  # noqa: BLE001
            salida["errores"].append(f"{s['id']} óptico: {e}")
        try:
            r["modis"] = nieve_modis(ee, p)
        except Exception as e:  # noqa: BLE001
            salida["errores"].append(f"{s['id']} MODIS: {e}")
        salida["sitios"][s["id"]] = r
        print(f"Satélite {s['id']}: {len(r.get('s1', []))} pasadas radar, {len(r.get('s2', []))} ópticas, "
              f"{len(r.get('modis', []))} días MODIS")
    try:
        terreno(ee)
    except Exception as e:  # noqa: BLE001
        salida["errores"].append(f"terreno: {e}")
    escribir(salida)


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        escribir({"generado": dt.datetime.now(dt.timezone.utc).isoformat(), "error": traceback.format_exc(limit=2)})
