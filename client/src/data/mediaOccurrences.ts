/**
 * Registro de **apariciones** de imágenes del sitio.
 *
 * El inventario ya no agrupa por archivo físico: cada lugar del sitio donde se
 * usa una imagen es un registro independiente, con identificador propio y
 * editable por separado. Dos apariciones pueden usar el mismo archivo (por
 * ejemplo `equipo-reunion.jpg`), pero se administran por separado.
 *
 * El identificador es el que viaja al panel y el que usa el sitio para
 * resolver un reemplazo: cada `<MediaImg>` declara el lugar donde aparece.
 *
 * El `image` es el asset compilado que se usa hoy, tal cual lo consume el
 * sitio: el registro describe la realidad actual, no la imagen que quedaría
 * después de un reemplazo desde el panel.
 */

import heroImage from "@/assets/casoratti-hero.jpg";
import officeImage from "@/assets/equipo-reunion.jpg";
import teamImage from "@/assets/equipo-sala.jpg";
import detailImage from "@/assets/equipo-pasillo.jpg";
import justiceImage from "@/assets/justice-scale.jpg";
import { areaImageAlt, practiceAreas } from "@/data/siteContent";

/** Una aparición de imagen en un lugar concreto del sitio. */
export type MediaOccurrence = {
  /** Identificador único y estable de la aparición. */
  id: string;
  /** URL del asset compilado que se usa hoy. */
  image: string;
  /** Página del sitio donde aparece. */
  page: string;
  /** Sección concreta dentro de la página. */
  section: string;
  /** Componente que la renderiza. */
  component: string;
  /** Texto alternativo actual. */
  alt: string;
};

/** Página donde viven las apariciones del detalle de un área. */
export const AREA_OCCURRENCE_PAGE = "Detalle del área";

/** Componente que renderiza las apariciones del detalle de un área. */
export const AREA_OCCURRENCE_COMPONENT = "AreaDetail";

/**
 * Apariciones fijas: las que no dependen del contenido de la página.
 *
 * Cada entrada es un lugar real del sitio, con su archivo, su texto
 * alternativo y su sección. El orden es el del sitio.
 */
const staticOccurrences: Record<string, MediaOccurrence> = {
  "home-hero": {
    id: "home-hero",
    image: heroImage,
    page: "Inicio",
    section: "Portada",
    component: "Home",
    alt: "Balanza dorada y biblioteca del Estudio Jurídico Casoratti",
  },
  "home-split": {
    id: "home-split",
    image: officeImage,
    page: "Inicio",
    section: "Presentación",
    component: "Home",
    alt: "El equipo del estudio en una reunión de trabajo",
  },
  "studio-intro": {
    id: "studio-intro",
    image: officeImage,
    page: "El estudio",
    section: "Encabezado",
    component: "Studio",
    alt: "El equipo del estudio en una reunión de trabajo",
  },
  "studio-gallery-main": {
    id: "studio-gallery-main",
    image: teamImage,
    page: "El estudio",
    section: "Galería principal",
    component: "Studio",
    alt: "Parte del equipo del estudio",
  },
  "studio-gallery-aside": {
    id: "studio-gallery-aside",
    image: detailImage,
    page: "El estudio",
    section: "Galería lateral",
    component: "Studio",
    alt: "Reunión de trabajo en el estudio",
  },
  "areas-intro": {
    id: "areas-intro",
    image: detailImage,
    page: "Áreas de práctica",
    section: "Encabezado",
    component: "Areas",
    alt: "Integrantes del estudio durante una jornada de trabajo",
  },
  "values-intro": {
    id: "values-intro",
    image: justiceImage,
    page: "Valores",
    section: "Encabezado",
    component: "Values",
    alt: "Balanza y martillo de justicia sobre la mesa del estudio",
  },
  "resources-intro": {
    id: "resources-intro",
    image: officeImage,
    page: "Centro de recursos",
    section: "Encabezado",
    component: "Resources",
    alt: "Dos profesionales del estudio ordenando documentación para una consulta",
  },
  "faq-intro": {
    id: "faq-intro",
    image: officeImage,
    page: "Preguntas frecuentes",
    section: "Encabezado",
    component: "FAQ",
    alt: "El equipo del estudio en una reunión de trabajo",
  },
  "contact-intro": {
    id: "contact-intro",
    image: detailImage,
    page: "Contacto",
    section: "Encabezado",
    component: "Contact",
    alt: "Integrantes del estudio durante una jornada de trabajo",
  },
};

/**
 * Apariciones del detalle de un área: el identificador y la imagen salen del
 * **slug real** del área, así que el registro se arma con `practiceAreas` y
 * nunca con una lista escrita a mano.
 */
const areaOccurrences: Record<string, MediaOccurrence> = Object.fromEntries(
  practiceAreas.map((area) => {
    const id = `area-detail-${area.slug}`;
    return [
      id,
      {
        id,
        image: area.image,
        page: AREA_OCCURRENCE_PAGE,
        section: area.label,
        component: AREA_OCCURRENCE_COMPONENT,
        alt: areaImageAlt[area.slug] ?? `Imagen del área ${area.title}`,
      },
    ];
  }),
);

/** Todas las apariciones del sitio, indexadas por su identificador. */
export const mediaOccurrences: Record<string, MediaOccurrence> = {
  ...staticOccurrences,
  ...areaOccurrences,
};

/**
 * Identificadores de aparición declarados en el sitio: las diez apariciones
 * fijas y las catorce del detalle de área, con su slug real.
 */
export const mediaOccurrenceIds: string[] = Object.keys(mediaOccurrences);
