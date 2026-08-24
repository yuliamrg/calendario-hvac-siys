export const VIEW_CLASSES = Object.freeze({
  catalogCollapsed: "catalog-collapsed",
  catalogMobileOpen: "catalog-mobile-open",
  motionEnhanced: "motion-enhanced",
  readOnly: "read-only"
});

export function deriveViewClasses(state = {}) {
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
  return classes;
}
