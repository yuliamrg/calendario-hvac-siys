export const VIEW_CLASSES = {
  catalogCollapsed: "catalog-collapsed",
  catalogMobileOpen: "catalog-mobile-open",
  motionEnhanced: "motion-enhanced",
  readOnly: "read-only"
};

export function deriveViewClasses(state) {
  const {
    catalogCollapsed = false,
    isMobileLayout = false,
    catalogMobileOpen = false,
    motionEnabled = false,
    prefersReducedMotion = false,
    hasEditControl = true
  } = state;

  const classes = {};

  classes[VIEW_CLASSES.catalogCollapsed] = !isMobileLayout && catalogCollapsed;
  classes[VIEW_CLASSES.catalogMobileOpen] = isMobileLayout && catalogMobileOpen;
  classes[VIEW_CLASSES.motionEnhanced] = motionEnabled && !prefersReducedMotion;
  classes[VIEW_CLASSES.readOnly] = !hasEditControl;

  return classes;
}

export function applyViewClasses(body, classes) {
  for (const [className, shouldApply] of Object.entries(classes)) {
    body.classList.toggle(className, shouldApply);
  }
}

export function createViewStateApplier(body) {
  return (state) => applyViewClasses(body, deriveViewClasses(state));
}

export function computeCatalogAriaExpanded(state) {
  const { catalogCollapsed = false, isMobileLayout = false, catalogMobileOpen = false } = state;
  if (isMobileLayout) return String(catalogMobileOpen);
  return String(!catalogCollapsed);
}

export function computeCatalogTitle(state) {
  const { catalogCollapsed = false, isMobileLayout = false, catalogMobileOpen = false } = state;
  if (isMobileLayout) {
    return catalogMobileOpen ? "Cerrar banco de tarjetas" : "Abrir banco de tarjetas";
  }
  return catalogCollapsed ? "Mostrar banco de tarjetas" : "Ocultar banco de tarjetas";
}