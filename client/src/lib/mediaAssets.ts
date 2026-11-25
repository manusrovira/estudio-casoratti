/**
 * Assets compilados del sitio y su ruta lógica estable.
 *
 * Vite renombra los assets con un hash al compilar (`/assets/hero-Dq7x.jpg`),
 * así que la URL del bundle no sirve como identidad estable. La **ruta
 * lógica** (`assets/hero.jpg`) sí: es la clave con la que el administrador
 * registra un reemplazo en Storage y la que el sitio usa para resolverlo.
 *
 * Este mapa es el único lugar donde se declara qué asset corresponde a qué
 * ruta lógica, de modo que el panel y el sitio público nunca se desincronicen.
 */

import heroImage from "@/assets/casoratti-hero.jpg";
import officeImage from "@/assets/equipo-reunion.jpg";
import teamImage from "@/assets/equipo-sala.jpg";
import detailImage from "@/assets/equipo-pasillo.jpg";
import justiceImage from "@/assets/justice-scale.jpg";
import audienceImage from "@/assets/equipo-audiencia-horizontal.jpg";

/** Ruta lógica → URL compilada por Vite. */
export const MEDIA_ASSETS: Record<string, string> = {
  "assets/casoratti-hero.jpg": heroImage,
  "assets/equipo-reunion.jpg": officeImage,
  "assets/equipo-sala.jpg": teamImage,
  "assets/equipo-pasillo.jpg": detailImage,
  "assets/justice-scale.jpg": justiceImage,
  "assets/equipo-audiencia-horizontal.jpg": audienceImage,
};

const byUrl = new Map<string, string>();
for (const [logicalPath, url] of Object.entries(MEDIA_ASSETS)) {
  byUrl.set(url, logicalPath);
}

/**
 * Ruta lógica de un asset del bundle, o `null` si la URL no corresponde a
 * ningún asset declarado.
 */
export function logicalPathForAsset(url: string): string | null {
  return byUrl.get(url) ?? null;
}
