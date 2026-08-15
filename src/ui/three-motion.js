const calendaryThreeMotion = (() => {
  let renderer = null;
  let scene = null;
  let camera = null;
  let group = null;
  let canvas = null;
  let frameHandle = null;
  let enabled = false;

  function reducedMotion() {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = Math.max(1, globalThis.innerWidth || 1);
    const height = Math.max(1, globalThis.innerHeight || 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function createScene() {
    if (renderer || !globalThis.THREE || !globalThis.document?.body || reducedMotion()) return Boolean(renderer);
    try {
      canvas = document.createElement("canvas");
      canvas.className = "three-motion-canvas";
      canvas.setAttribute("aria-hidden", "true");
      document.body.prepend(canvas);
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      camera.position.z = 14;
      group = new THREE.Group();
      scene.add(group);

      const colors = [0x7ba889, 0xd6a44a, 0x75a7c8, 0xb97b75];
      const geometry = new THREE.BoxGeometry(0.34, 0.34, 0.34);
      const points = [];
      for (let index = 0; index < 24; index += 1) {
        const angle = (index / 24) * Math.PI * 2;
        const radius = 4.5 + (index % 3) * 0.7;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle * 1.7) * 2.7;
        const z = Math.sin(angle) * 1.6 - 1;
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
          color: colors[index % colors.length],
          transparent: true,
          opacity: 0.24
        }));
        mesh.position.set(x, y, z);
        mesh.userData.phase = index * 0.42;
        group.add(mesh);
        points.push(x, y, z);
      }
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      group.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
        color: 0x8da995,
        transparent: true,
        opacity: 0.16
      })));
      resize();
      globalThis.addEventListener?.("resize", resize, { passive: true });
      return true;
    } catch {
      canvas?.remove();
      renderer = null;
      scene = null;
      camera = null;
      group = null;
      canvas = null;
      return false;
    }
  }

  function animate(time = 0) {
    if (!enabled || !renderer || !scene || !camera || !group) return;
    group.rotation.y = time * 0.000035;
    group.rotation.x = Math.sin(time * 0.00018) * 0.06;
    group.children.forEach((child) => {
      if (!child.isMesh) return;
      child.rotation.x = time * 0.00035 + child.userData.phase;
      child.rotation.y = time * 0.00025 + child.userData.phase;
      child.position.z += Math.sin(time * 0.0008 + child.userData.phase) * 0.0008;
    });
    renderer.render(scene, camera);
    frameHandle = globalThis.requestAnimationFrame?.(animate) ?? null;
  }

  function setEnabled(value) {
    enabled = Boolean(value) && !reducedMotion();
    if (!enabled) {
      if (frameHandle !== null) globalThis.cancelAnimationFrame?.(frameHandle);
      frameHandle = null;
      if (canvas) canvas.hidden = true;
      return;
    }
    if (!createScene()) return;
    canvas.hidden = false;
    if (frameHandle === null) frameHandle = globalThis.requestAnimationFrame?.(animate) ?? null;
  }

  return Object.freeze({ setEnabled });
})();

globalThis.calendaryThreeMotion = calendaryThreeMotion;
