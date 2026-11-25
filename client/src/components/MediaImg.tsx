import { logicalPathForAsset } from "@/lib/mediaAssets";
import { useMediaSrc } from "@/lib/mediaResolver";

/**
 * Imagen del sitio que respeta los reemplazos cargados desde el panel.
 *
 * El sitio se compila como estático: una imagen del bundle no se puede
 * sobrescribir en producción. Lo que sí existe es el bucket `site-media`, y
 * cuando el administrador reemplaza un asset, la versión nueva se resuelve
 * por su ruta lógica.
 *
 * Si no hay reemplazo —o si el servidor no responde— se usa **exactamente**
 * el asset compilado: el `alt`, el `className` y el diseño no cambian nunca.
 */
export function MediaImg({
  src,
  alt,
  className,
  width,
  height,
  loading,
  decoding,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number | string;
  height?: number | string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
}) {
  const logicalPath = logicalPathForAsset(src) ?? "";
  const resolved = useMediaSrc(logicalPath, src);

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
    />
  );
}
