import { logicalPathForAsset } from "@/lib/mediaAssets";
import { useMediaHidden, useMediaSrc } from "@/lib/mediaResolver";

/**
 * Imagen del sitio que respeta los reemplazos cargados desde el panel.
 *
 * El sitio se compila como estático: una imagen del bundle no se puede
 * sobrescribir en producción. Lo que sí existe es el bucket `site-media`, y
 * cuando el administrador reemplaza una **aparición** concreta, esa versión
 * nueva se resuelve por su identificador.
 *
 * Cada `<MediaImg>` declara su aparición (`occurrence`). Con ella:
 *
 *  - el reemplazo de esa aparición tiene prioridad sobre el del archivo;
 *  - si el administrador quitó la imagen de ese lugar, no se renderiza, pero
 *    el resto de la sección queda igual.
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
  occurrence,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number | string;
  height?: number | string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
  /** Identificador de la aparición: el lugar del sitio donde se usa. */
  occurrence?: string;
}) {
  const occurrenceId = occurrence ?? null;
  const resolved = useMediaSrc(occurrenceId, logicalPathForAsset(src), src);
  const hidden = useMediaHidden(occurrenceId);

  // La aparición fue quitada del sitio: no se muestra la imagen.
  if (hidden) return null;

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
