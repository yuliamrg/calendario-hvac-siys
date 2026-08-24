import test from "node:test";
import assert from "node:assert/strict";

import {
  VIEW_CLASSES,
  deriveViewClasses,
  applyViewClasses
} from "../src/ui/view-state.js";

function state(overrides = {}) {
  return {
    catalogCollapsed: false,
    isMobileLayout: false,
    catalogMobileOpen: false,
    motionEnabled: false,
    prefersReducedMotion: false,
    hasEditControl: true,
    ...overrides
  };
}

test("deriveViewClasses maps desktop, motion and access state", () => {
  assert.deepEqual(
    deriveViewClasses(state({
      catalogCollapsed: true,
      motionEnabled: true,
      hasEditControl: false
    })),
    {
      [VIEW_CLASSES.catalogCollapsed]: true,
      [VIEW_CLASSES.catalogMobileOpen]: false,
      [VIEW_CLASSES.motionEnhanced]: true,
      [VIEW_CLASSES.readOnly]: true
    }
  );
});

test("deriveViewClasses prevents desktop and mobile catalog flags from overlapping", () => {
  assert.equal(
    deriveViewClasses(state({
      catalogCollapsed: true,
      isMobileLayout: true,
      catalogMobileOpen: true
    }))[VIEW_CLASSES.catalogCollapsed],
    false
  );
  assert.equal(
    deriveViewClasses(state({
      isMobileLayout: false,
      catalogMobileOpen: true
    }))[VIEW_CLASSES.catalogMobileOpen],
    false
  );
});

test("deriveViewClasses respects reduced motion", () => {
  assert.equal(
    deriveViewClasses(state({ motionEnabled: true, prefersReducedMotion: true }))[VIEW_CLASSES.motionEnhanced],
    false
  );
});

test("applyViewClasses applies every projected class and returns the projection", () => {
  const toggled = new Map();
  const body = { classList: { toggle: (className, value) => toggled.set(className, value) } };
  const classes = deriveViewClasses(state({
    isMobileLayout: true,
    catalogMobileOpen: true,
    motionEnabled: true,
    hasEditControl: false
  }));

  assert.equal(applyViewClasses(body, classes), classes);
  assert.deepEqual(Object.fromEntries(toggled), classes);
});

test("empty state has safe defaults", () => {
  assert.deepEqual(deriveViewClasses(), {
    [VIEW_CLASSES.catalogCollapsed]: false,
    [VIEW_CLASSES.catalogMobileOpen]: false,
    [VIEW_CLASSES.motionEnhanced]: false,
    [VIEW_CLASSES.readOnly]: false
  });
});
