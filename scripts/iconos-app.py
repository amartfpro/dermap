"""
Genera el logo y los iconos de la aplicación a partir de la golondrina (src/marca/golondrina.svg).

  python3 scripts/iconos-app.py      (necesita Playwright con Chromium, Pillow y `npx tauri`)

Dos variantes: la detallada (64 px o más) y la de tamaños pequeños (48 px o menos), con la
golondrina más grande y el trazo algo engordado para que las líneas finas no desaparezcan.
El icono es la golondrina naranja sobre un cuadrado negro redondeado.
"""
import asyncio, re, subprocess, tempfile
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parent.parent
ICONOS = RAIZ / "src-tauri" / "icons"
NARANJA, NEGRO = "#ff4600", "#0a0908"

fuente = (RAIZ / "src" / "marca" / "golondrina.svg").read_text(encoding="utf-8")
D = next(re.search(r'd="([^"]+)"', m.group(1)).group(1) for m in re.finditer(r"<path ([^>]*)>", fuente) if 'fill="#fff"' in m.group(1))
BB = (0.0, 29.4, 621.0, 494.1)  # caja de la golondrina en su SVG


def golondrina(escala, tx, ty, trazo=0):
    st = f' stroke="{NARANJA}" stroke-width="{trazo}" stroke-linejoin="round"' if trazo else ""
    return f'<path transform="translate({tx:.1f} {ty:.1f}) scale({escala:.4f})" fill="{NARANJA}"{st} d="{D}"/>'


def icono(pequeno: bool, margen=0.0) -> str:
    """Cuadrado negro redondeado con la golondrina. `margen`: aire transparente alrededor (macOS)."""
    N = 1024
    lado = N * (1 - 2 * margen)
    o = N * margen
    escala = lado * (0.84 if pequeno else 0.70) / BB[2]
    w, h = BB[2] * escala, BB[3] * escala
    tx = o + (lado - w) / 2 - BB[0] * escala
    ty = o + (lado - h) / 2 - BB[1] * escala + lado * 0.01
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}">'
        f'<rect x="{o:.1f}" y="{o:.1f}" width="{lado:.1f}" height="{lado:.1f}" rx="{lado * 0.22:.1f}" fill="{NEGRO}"/>'
        + golondrina(escala, tx, ty, 14 if pequeno else 0)
        + "</svg>"
    )


def logo() -> str:
    """La golondrina sola, para dentro de la aplicación (cabecera e inicio): tamaños pequeños."""
    t = 16
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{BB[0] - t:.1f} {BB[1] - t:.1f} {BB[2] + 2 * t:.1f} {BB[3] + 2 * t:.1f}">'
        + golondrina(1, 0, 0, t)
        + "</svg>"
    )


async def rasterizar(trabajos):
    """trabajos: [(svg, tamaño, ruta)]."""
    async with async_playwright() as p:
        nav = await p.chromium.launch()
        pagina = await nav.new_page()
        with tempfile.TemporaryDirectory() as tmp:
            for i, (svg, n, ruta) in enumerate(trabajos):
                f = Path(tmp) / f"{i}.svg"
                f.write_text(svg, encoding="utf-8")
                await pagina.set_viewport_size({"width": n, "height": n})
                await pagina.goto(f.as_uri())
                await pagina.evaluate(f"(()=>{{const s=document.documentElement; s.setAttribute('width',{n}); s.setAttribute('height',{n});}})()")
                await pagina.screenshot(path=str(ruta), omit_background=True, clip={"x": 0, "y": 0, "width": n, "height": n})
        await nav.close()


async def main():
    grande, pequeno = icono(False), icono(True)
    (ICONOS / "icono.svg").write_text(grande, encoding="utf-8")
    (ICONOS / "icono-pequeno.svg").write_text(pequeno, encoding="utf-8")
    (RAIZ / "src" / "marca" / "logo.svg").write_text(logo(), encoding="utf-8")
    (RAIZ / "public" / "favicon.svg").write_text(pequeno, encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # 1) Todo a partir de la variante detallada (lo que hace `tauri icon`).
        await rasterizar([(grande, 1024, tmp / "fuente.png")])
        subprocess.run(["npx", "tauri", "icon", str(tmp / "fuente.png"), "-o", str(ICONOS)], cwd=RAIZ, check=True)
        for sobra in ["android", "ios"]:
            subprocess.run(["rm", "-rf", str(ICONOS / sobra)])

        # 2) Los tamaños pequeños, con la variante para tamaños pequeños.
        peq = {n: tmp / f"p{n}.png" for n in [16, 24, 30, 32, 44, 48, 50, 64]}
        gra = {n: tmp / f"g{n}.png" for n in [64, 128, 256]}
        mac = {n: tmp / f"m{n}.png" for n in [16, 32, 64, 128, 256, 512, 1024]}
        await rasterizar(
            [(pequeno, n, r) for n, r in peq.items()]
            + [(grande, n, r) for n, r in gra.items()]
            # macOS: el icono lleva aire alrededor (plantilla de Apple: 824 de 1024).
            + [(icono(n <= 64, margen=100 / 1024), n, r) for n, r in mac.items()]
        )
        Image.open(peq[32]).save(ICONOS / "32x32.png")
        Image.open(peq[30]).save(ICONOS / "Square30x30Logo.png")
        Image.open(peq[44]).save(ICONOS / "Square44x44Logo.png")
        Image.open(peq[50]).save(ICONOS / "StoreLogo.png")

        # Windows (.ico): 16–48 con la variante pequeña; 64–256 con la detallada.
        capas = [Image.open(peq[n]) for n in [16, 24, 32, 48]] + [Image.open(gra[n]) for n in [64, 128, 256]]
        capas[-1].save(ICONOS / "icon.ico", format="ICO", sizes=[c.size for c in capas], append_images=capas[:-1])

        # macOS (.icns).
        capas = [Image.open(mac[n]) for n in sorted(mac)]
        capas[-1].save(ICONOS / "icon.icns", format="ICNS", append_images=capas[:-1])


asyncio.run(main())
