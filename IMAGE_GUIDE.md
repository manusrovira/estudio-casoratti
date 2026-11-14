# Guía de imágenes — Estudio Jurídico Casoratti

Todas las imágenes compiladas por Vite están en `client/src/assets/`. Se importan desde TypeScript y se transforman automáticamente al ejecutar `pnpm build:static`.

## Mapa de uso

| Archivo | Dónde aparece | Uso visual |
|---|---|---|
| `casoratti-hero.jpg` | `client/src/pages/SitePages.tsx` → `Home()` → `.hero-premium` | Imagen principal del primer pantallazo del inicio. Tiene animación de zoom lento, overlay oscuro y el mensaje institucional superpuesto. |
| `gavel.jpg` | `client/src/data/siteContent.ts` | Imagen de detalle para Derecho civil y comercial, Derecho penal, Derecho penal económico y Daños y seguros. También se reutiliza como imagen de encabezado en `/areas` y `/recursos` mediante `images.law`. |
| `meeting.jpg` | `client/src/data/siteContent.ts` y `SitePages.tsx` | Imagen de detalle para Derecho de familia, Derecho laboral y Mediación y negociación. También se usa en la galería de `/el-estudio` y como imagen del encabezado de `/contacto`. |
| `office.jpg` | `client/src/data/siteContent.ts` | Imagen de detalle para Defensa del consumidor y Gestoría automotor. |
| `office-wide.jpg` | `client/src/data/siteContent.ts` y `SitePages.tsx` | Imagen de detalle para Sucesiones y Societario y empresarial. También se usa en el bloque “Cómo trabajamos” de Inicio, en `/el-estudio` y como encabezado de `/preguntas-frecuentes`. |
| `sign.jpg` | `client/src/data/siteContent.ts` | Imagen de detalle para Administrativo y previsional. |
| `team.jpg` | `client/src/pages/SitePages.tsx` → `Studio()` y `Values()` | Fotografía del equipo: galería de `/el-estudio` y encabezado de `/valores`. |
| `team-room.jpg` | `client/src/assets/` | Asset histórico conservado en la biblioteca del proyecto. El hero actual utiliza `casoratti-hero.jpg`. |
| `scales.webp` | `client/src/assets/` | Asset histórico conservado en la biblioteca del proyecto; no es requerido por las rutas actuales del portal. |

## Cómo cambiar una imagen

1. Reemplazá el archivo conservando el mismo nombre y extensión, o agregá un archivo nuevo dentro de `client/src/assets/`.
2. Para una imagen de especialidad, actualizá la propiedad `image` del objeto correspondiente en `practiceAreas`, dentro de `client/src/data/siteContent.ts`.
3. Para una imagen de página institucional, modificá el import y el objeto `images` en `client/src/pages/SitePages.tsx`.
4. Conservá siempre un `alt` descriptivo en los elementos `<img>`.
5. Ejecutá `pnpm check` y `pnpm build:static` antes de guardar cambios.

## Estructura relevante

```text
client/
└── src/
    ├── assets/                 # Imágenes fuente incluidas en el código
    ├── data/siteContent.ts     # Asociación imagen ↔ especialidad
    └── pages/SitePages.tsx     # Asociación imagen ↔ página institucional
```

La guía no incluye credenciales ni dependencias instaladas. El contenido jurídico del sitio es general y no reemplaza una consulta profesional.
