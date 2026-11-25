/**
 * Plugin de Vite que emite el manifiesto de imágenes del sitio.
 *
 * En el build (`generateBundle`) empareja cada asset de origen con el archivo
 * que Vite acaba de emitir —con su nombre real hasheado— y escribe
 * `media-manifest.json` en la raíz de `dist/public`. En el servidor de
 * desarrollo sirve el mismo archivo con las rutas de desarrollo, para que el
 * panel pueda consultar el inventario sin esperar un build.
 *
 * El plugin se registra en `vite.config.ts` (lo hace el agente principal).
 */

import fs from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { buildMediaManifest, type EmittedAsset } from "./mediaManifest.server";

/** Nombre del archivo emitido, en la raíz del sitio. */
export const MEDIA_MANIFEST_FILE_NAME = "media-manifest.json";

export type MediaManifestPluginOptions = {
  /** Raíz del repositorio. Por defecto se deduce de la raíz de Vite. */
  repoRoot?: string;
};

type ProjectDirs = {
  repoRoot: string;
  clientDir: string;
  publicDir: string;
  assetsDir: string;
};

/**
 * Deduce las carpetas del proyecto a partir de la raíz de Vite.
 * En este proyecto la raíz de Vite es `client/`, así que la raíz del
 * repositorio es su carpeta padre.
 */
function resolveProjectDirs(config: ResolvedConfig): ProjectDirs {
  let clientDir = config.root;
  if (path.basename(clientDir) !== "client") {
    const candidate = path.join(clientDir, "client");
    if (fs.existsSync(path.join(candidate, "src"))) clientDir = candidate;
  }
  const publicDir =
    typeof config.publicDir === "string" && fs.existsSync(config.publicDir)
      ? config.publicDir
      : path.join(clientDir, "public");
  return {
    repoRoot: path.dirname(clientDir),
    clientDir,
    publicDir,
    assetsDir: path.join(clientDir, "src", "assets"),
  };
}

function collectEmitted(bundle: Record<string, unknown>): EmittedAsset[] {
  const emitted: EmittedAsset[] = [];
  for (const file of Object.values(bundle)) {
    if (!file || typeof file !== "object") continue;
    const asset = file as {
      type?: string;
      fileName?: string;
      name?: string;
      names?: string[];
      originalFileName?: string | null;
      originalFileNames?: string[];
    };
    if (asset.type !== "asset" || !asset.fileName) continue;
    emitted.push({
      fileName: asset.fileName,
      name: asset.name,
      names: asset.names,
      originalFileName: asset.originalFileName,
      originalFileNames: asset.originalFileNames,
    });
  }
  return emitted;
}

export function mediaManifestPlugin(options: MediaManifestPluginOptions = {}): Plugin {
  let dirs: ProjectDirs | null = null;
  let base = "/";

  return {
    name: "casoratti-media-manifest",

    configResolved(config) {
      dirs = resolveProjectDirs(config);
      base = config.base;
      if (options.repoRoot) dirs = { ...dirs, repoRoot: options.repoRoot };
    },

    /** En desarrollo se sirve el manifiesto con las rutas reales de Vite. */
    configureServer(server) {
      server.middlewares.use(`/${MEDIA_MANIFEST_FILE_NAME}`, (_req, res) => {
        const project = dirs;
        if (!project) {
          res.statusCode = 500;
          res.end("{}");
          return;
        }
        const manifest = buildMediaManifest({ ...project, base });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(manifest, null, 2));
      });
    },

    /** En el build se emite con las URLs hasheadas que serves el sitio. */
    generateBundle(_outputOptions, bundle) {
      const project = dirs;
      if (!project) return;
      const manifest = buildMediaManifest({
        ...project,
        base,
        emitted: collectEmitted(bundle as Record<string, unknown>),
      });
      this.emitFile({
        type: "asset",
        fileName: MEDIA_MANIFEST_FILE_NAME,
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}

export default mediaManifestPlugin;
