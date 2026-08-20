import test from "node:test";
import assert from "node:assert/strict";
import {
  VIEW_CLASSES,
  deriveViewClasses,
  applyViewClasses,
  createViewStateApplier,
  computeCatalogAriaExpanded,
  computeCatalogTitle
} from "../src/ui/view-state.js";

test("VIEW_CLASSES exports expected class names", () => {
  assert.equal(VIEW_CLASSES.catalogCollapsed, "catalog-collapsed");
  assert.equal(VIEW_CLASSES.catalogMobileOpen, "catalog-mobile-open");
  assert.equal(VIEW_CLASSES.motionEnhanced, "motion-enhanced");
  assert.equal(VIEW_CLASSES.readOnly, "read-only");
});

test("deriveViewClasses returns all four flags for desktop catalog collapsed", () => {
  const state = {
    catalogCollapsed: true,
    isMobileLayout: false,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: true
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["catalog-collapsed"], true);
  assert.equal(classes["catalog-mobile-open"], false);
  assert.equal(classes["motion-enhanced"], true);
  assert.equal(classes["read-only"], false);
});

test("deriveViewClasses returns all four flags for desktop catalog open", () => {
  const state = {
    catalogCollapsed: false,
    isMobileLayout: false,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: true
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["catalog-collapsed"], false);
  assert.equal(classes["catalog-mobile-open"], false);
  assert.equal(classes["motion-enhanced"], true);
  assert.equal(classes["read-only"], false);
});

test("deriveViewClasses returns mobile catalog open state", () => {
  const state = {
    catalogCollapsed: false,
    isMobileLayout: true,
    catalogMobileOpen: true,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: true
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["catalog-collapsed"], false);
  assert.equal(classes["catalog-mobile-open"], true);
  assert.equal(classes["motion-enhanced"], true);
  assert.equal(classes["read-only"], false);
});

test("deriveViewClasses returns mobile catalog closed state", () => {
  const state = {
    catalogCollapsed: false,
    isMobileLayout: true,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: true
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["catalog-collapsed"], false);
  assert.equal(classes["catalog-mobile-open"], false);
  assert.equal(classes["motion-enhanced"], true);
  assert.equal(classes["read-only"], false);
});

test("deriveViewClasses respects prefersReducedMotion for motion-enhanced", () => {
  const state = {
    catalogCollapsed: false,
    isMobileLayout: false,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: true,
    hasEditControl: true
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["motion-enhanced"], false);
});

test("deriveViewClasses returns read-only when hasEditControl is false", () => {
  const state = {
    catalogCollapsed: false,
    isMobileLayout: false,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: false
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["read-only"], true);
});

test("deriveViewClasses defaults to sensible values when state is empty", () => {
  const classes = deriveViewClasses({});
  assert.equal(classes["catalog-collapsed"], false);
  assert.equal(classes["catalog-mobile-open"], false);
  assert.equal(classes["motion-enhanced"], false);
  assert.equal(classes["read-only"], false);
});

test("deriveViewClasses handles partial state gracefully", () => {
  const classes = deriveViewClasses({ motionEnabled: true });
  assert.equal(classes["motion-enhanced"], true);
  assert.equal(classes["catalog-collapsed"], false);
  assert.equal(classes["catalog-mobile-open"], false);
  assert.equal(classes["read-only"], false);
});

test("applyViewClasses toggles classes on body element", () => {
  const body = {
    classList: {
      toggled: {},
      toggle(className, force) {
        this.toggled[className] = force;
      }
    }
  };
  const classes = {
    "catalog-collapsed": true,
    "catalog-mobile-open": false,
    "motion-enhanced": true,
    "read-only": false
  };
  applyViewClasses(body, classes);
  assert.equal(body.classList.toggled["catalog-collapsed"], true);
  assert.equal(body.classList.toggled["catalog-mobile-open"], false);
  assert.equal(body.classList.toggled["motion-enhanced"], true);
  assert.equal(body.classList.toggled["read-only"], false);
});

test("createViewStateApplier returns a function that applies classes to given body", () => {
  const body = {
    classList: {
      toggled: {},
      toggle(className, force) {
        this.toggled[className] = force;
      }
    }
  };
  const applier = createViewStateApplier(body);
  applier({
    catalogCollapsed: true,
    isMobileLayout: false,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: false
  });
  assert.equal(body.classList.toggled["catalog-collapsed"], true);
  assert.equal(body.classList.toggled["read-only"], true);
});

test("computeCatalogAriaExpanded returns true for mobile open", () => {
  assert.equal(computeCatalogAriaExpanded({ isMobileLayout: true, catalogMobileOpen: true }), "true");
  assert.equal(computeCatalogAriaExpanded({ isMobileLayout: true, catalogMobileOpen: false }), "false");
});

test("computeCatalogAriaExpanded returns true for desktop not collapsed", () => {
  assert.equal(computeCatalogAriaExpanded({ isMobileLayout: false, catalogCollapsed: false }), "true");
  assert.equal(computeCatalogAriaExpanded({ isMobileLayout: false, catalogCollapsed: true }), "false");
});

test("computeCatalogTitle returns mobile labels", () => {
  assert.equal(computeCatalogTitle({ isMobileLayout: true, catalogMobileOpen: true }), "Cerrar banco de tarjetas");
  assert.equal(computeCatalogTitle({ isMobileLayout: true, catalogMobileOpen: false }), "Abrir banco de tarjetas");
});

test("computeCatalogTitle returns desktop labels", () => {
  assert.equal(computeCatalogTitle({ isMobileLayout: false, catalogCollapsed: true }), "Mostrar banco de tarjetas");
  assert.equal(computeCatalogTitle({ isMobileLayout: false, catalogCollapsed: false }), "Ocultar banco de tarjetas");
});

test("deriveViewClasses correctly combines read-only with other states", () => {
  const state = {
    catalogCollapsed: true,
    isMobileLayout: false,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: false
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["catalog-collapsed"], true);
  assert.equal(classes["motion-enhanced"], true);
  assert.equal(classes["read-only"], true);
});

test("deriveViewClasses correctly combines mobile with read-only", () => {
  const state = {
    catalogCollapsed: false,
    isMobileLayout: true,
    catalogMobileOpen: true,
    motionEnabled: true,
    prefersReducedMotion: true,
    hasEditControl: false
  };
  const classes = deriveViewClasses(state);
  assert.equal(classes["catalog-mobile-open"], true);
  assert.equal(classes["motion-enhanced"], false);
  assert.equal(classes["read-only"], true);
});

test("catalog-collapsed is never true in mobile layout", () => {
  const classes = deriveViewClasses({
    catalogCollapsed: true,
    isMobileLayout: true,
    catalogMobileOpen: false,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: true
  });
  assert.equal(classes["catalog-collapsed"], false);
});

test("catalog-mobile-open is never true in desktop layout", () => {
  const classes = deriveViewClasses({
    catalogCollapsed: false,
    isMobileLayout: false,
    catalogMobileOpen: true,
    motionEnabled: true,
    prefersReducedMotion: false,
    hasEditControl: true
  });
  assert.equal(classes["catalog-mobile-open"], false);
});