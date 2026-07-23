export const STICKER_QUALITY_GUIDELINE_VERSION = 'geometry-first-v1.0';

export const STICKER_QUALITY_SCORING = Object.freeze({
  silhouetteQuality: 25,
  compositionAndBalance: 20,
  outlineAndEdgeQuality: 20,
  thumbnailReadability: 15,
  internalGeometry: 10,
  collectionConsistency: 7,
  subjectContent: 3
});

/** Canonical seller-facing standard. Provider requests use the compact form below. */
export const STICKER_QUALITY_CANONICAL = `
1. Strong silhouette — recognizable form, cohesive outer mass, smooth natural contour, balanced visual weight and intentional organic asymmetry.
2. Balanced composition — clear center and focal area, supporting elements, stable weight distribution, intentional negative space and natural visual flow.
3. Good canvas usage — prominent subject, comfortable consistent margins, visual-weight centering and breathing room for the outline.
4. Clean outer contour — smooth practical sticker shape, simplified micro-detail, identity-preserving corners and no accidental protrusions.
5. Consistent white outline — thin, clean, accurate and visually even around curves and details while preserving intentional openings.
6. Clean transparent presentation — sharp alpha, no gray halo or matte contamination, no accidental holes and immediate digital usability.
7. Clear internal geometry — believable connections, overlaps, perspective, repeated proportions and intentional openings.
8. Thumbnail readability — silhouette, focal point, major forms, contrast and balance remain clear when reduced.
9. Controlled detail — detail enriches the design without cluttering or weakening the primary shape.
10. Attractive negative space — internal and external openings create clarity, rhythm and stable frames, wreaths, arches, handles and layered forms.
11. Visual depth and contrast — cohesive color, controlled highlights/shadows and separation of major forms.
12. Collection consistency — outline, margin, scale, rendering, texture, shadow depth, color treatment, edge sharpness and softness remain locked.
13. Geometric variety — vary silhouette, orientation, proportions, mass distribution, composition, viewing angle, negative space and supporting placement.
14. Professional output — transparent PNG, minimum 1024×1024, sharp, centered, consistently margined and ready for digital or printable use.
15. Scoring — silhouette 25%, composition 20%, outline/edges 20%, thumbnail readability 15%, internal geometry 10%, consistency 7%, subject content 3%. A simple polished sticker outranks a complex weak one.
`.trim();

/**
 * Compact provider-facing version of the canonical visual standard. It is
 * intentionally concise so every image request receives the same geometry
 * rules without spending tokens on the full seller-facing document.
 */
export const STICKER_GENERATION_QUALITY_COMPACT = `
GEOMETRY-FIRST STICKER QUALITY STANDARD (${STICKER_QUALITY_GUIDELINE_VERSION}):
- Prioritize the complete visual shape over subject complexity: strong recognizable silhouette, compact cohesive mass, smooth intentional contour and balanced organic asymmetry.
- Build a stable composition with one clear focal area, useful negative space, believable overlaps, coherent internal geometry and visually balanced weight.
- Fill the canvas confidently while preserving comfortable, consistent margins and room for the die-cut outline; center by visual weight, not only coordinates.
- Use one thin, smooth, consistent white die-cut outline that follows the real silhouette, preserves intentional openings and never becomes a chunky halo.
- Keep the subject fully visible and readable at small marketplace-thumbnail size. Simplify edge noise and control detail so it enriches rather than weakens the silhouette.
- Preserve physically meaningful openings and fill them with the exact reserved matte key used in all four canvas corners; never infer holes from black or other artwork colors.
- Maintain clear depth, contrast, color separation, highlights and shadows inside the artwork while keeping the external presentation shadow-free and transparency-ready.
- Match the collection's rendering style, outline thickness, margins, subject scale, texture density, edge sharpness and color treatment.
- Across the pack, vary silhouette, orientation, aspect ratio, visual-mass distribution and viewing angle without changing the locked art style.
- A simple polished sticker is better than a complex sticker with weak geometry.`.trim();

export const STICKER_QA_RUBRIC_COMPACT = `
Score visual quality with these weights: silhouette 25%, composition/balance 20%, outline/edges 20%, thumbnail readability 15%, internal geometry 10%, collection consistency 7%, subject content 3%. Automatic rejection is reserved for severe sellability defects: malformed or cropped subject, broken silhouette, background rectangle, dirty halo, accidental transparency damage, corrupted interior void, unreadable required text, watermark/logo, or practical duplicate. Softer aesthetic weaknesses should be reported, not trigger an unlimited regeneration loop.`.trim();

export const appendStickerQualityGuidelines = (prompt: string) =>
  `${prompt.trim()}\n\n${STICKER_GENERATION_QUALITY_COMPACT}`;
