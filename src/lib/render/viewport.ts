import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { EditEvent } from '$lib/core/editor';
import type { Vec3 } from '$lib/core/grid';
import { buildChunk, CHUNK } from '$lib/core/mesher';
import { raycast, rayPlane, type RayHit } from '$lib/core/raycast';
import { mirrorCells } from '$lib/core/tools';
import { boxRegion, editCells, fillAt, pickAt } from '$lib/editing';
import { app, editor, type BoxMode } from '$lib/state/app.svelte';

type Drag =
  | { kind: 'stroke'; mode: BoxMode; axis: number; plane: number; coord: number }
  | { kind: 'box'; mode: BoxMode; start: Vec3; end: Vec3; axis: number; plane: number; sign: number };

const COLORS = {
  background: 0x1b1d22,
  grid: 0x30333b,
  gridMajor: 0x454954,
  bounds: 0x3a3e48,
  place: 0xffffff,
  erase: 0xff5a5a,
  other: 0xffd54f,
  slice: 0x4f8cff,
  highlight: 0xff3d71,
};

/** Three.js scene for the voxel model: chunked meshes, camera controls and 3D editing. */
export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private material = new THREE.MeshBasicMaterial({ vertexColors: true });
  private chunkGroup = new THREE.Group();
  private chunks = new Map<number, THREE.Mesh>();
  private dirtyChunks = new Set<number>();
  private rgb = new Float32Array(256 * 3);
  private maxZ = Infinity;
  private guides = new THREE.Group();
  private ghosts: THREE.LineSegments[] = [];
  private boxPreview: THREE.Mesh;
  private slicePlane: THREE.Mesh;
  private highlightMesh: THREE.Mesh | null = null;
  private mirrorPlanes = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private drag: Drag | null = null;
  private orbitHeld = false;
  private frameRequested = false;
  private snapRaf = 0;
  private disposers: (() => void)[] = [];
  /** Called with the camera's orientation whenever the camera moves. */
  onCamera: ((q: THREE.Quaternion) => void) | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(COLORS.background);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => {
      this.requestRender();
      this.onCamera?.(this.camera.quaternion);
    });

    this.scene.add(this.chunkGroup, this.guides, this.mirrorPlanes);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04));
    for (let i = 0; i < 8; i++) {
      const g = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: COLORS.place, depthTest: false, transparent: true }));
      g.renderOrder = 10;
      g.visible = false;
      this.ghosts.push(g);
      this.scene.add(g);
    }
    this.boxPreview = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.boxPreview.visible = false;
    this.boxPreview.renderOrder = 9;
    this.slicePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: COLORS.slice, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.slicePlane.visible = false;
    this.scene.add(this.boxPreview, this.slicePlane);

    const el = this.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      t.addEventListener(type, fn as EventListener);
      this.disposers.push(() => t.removeEventListener(type, fn as EventListener));
    };
    on(el, 'pointerdown', (e) => this.onDown(e));
    on(el, 'pointermove', (e) => this.onMove(e));
    on(el, 'pointerup', (e) => this.onUp(e));
    on(el, 'pointercancel', (e) => this.onUp(e));
    on(el, 'pointerleave', () => { if (!this.drag) this.showTarget(null); });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'wheel', () => this.cancelSnap());
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    on(window, 'blur', () => this.setOrbitHeld(false));

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());
    this.disposers.push(editor.on((e) => this.onEdit(e)));

    this.reset();
  }

  dispose() {
    this.cancelSnap();
    this.onCamera = null;
    for (const d of this.disposers) d();
    this.controls.dispose();
    for (const m of this.chunks.values()) m.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- model sync

  private onEdit(e: EditEvent) {
    if (e.kind === 'reset') return this.reset();
    if (e.kind === 'meta') return;
    if (e.kind === 'palette') {
      this.updateColors();
      this.markAll();
    } else {
      const g = editor.grid;
      for (let k = 0; k < e.idx.length; k++) this.markCell(...g.coords(e.idx[k]));
    }
    this.requestRender();
  }

  private reset() {
    for (const m of this.chunks.values()) {
      m.geometry.dispose();
      this.chunkGroup.remove(m);
    }
    this.chunks.clear();
    this.updateColors();
    this.buildGuides();
    this.markAll();
    this.frame();
  }

  private updateColors() {
    const c = new THREE.Color();
    editor.palette.forEach((hex, i) => {
      c.setHex(hex);
      this.rgb[i * 3] = c.r;
      this.rgb[i * 3 + 1] = c.g;
      this.rgb[i * 3 + 2] = c.b;
    });
  }

  private chunkCounts() {
    const g = editor.grid;
    return [Math.ceil(g.sx / CHUNK), Math.ceil(g.sy / CHUNK), Math.ceil(g.sz / CHUNK)];
  }

  private markAll() {
    const [nx, ny, nz] = this.chunkCounts();
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) this.dirtyChunks.add(x + 8 * (y + 8 * z));
  }

  /** Marks the chunk containing a cell, plus neighbours whose border faces depend on it. */
  private markCell(x: number, y: number, z: number) {
    const [nx, ny, nz] = this.chunkCounts();
    const c = [x, y, z].map((v) => Math.floor(v / CHUNK));
    const lim = [nx, ny, nz];
    const p = [x, y, z];
    const add = (cc: number[]) => {
      if (cc.every((v, k) => v >= 0 && v < lim[k])) this.dirtyChunks.add(cc[0] + 8 * (cc[1] + 8 * cc[2]));
    };
    add(c);
    for (let k = 0; k < 3; k++) {
      if (p[k] % CHUNK === 0) { const n = c.slice(); n[k]--; add(n); }
      if (p[k] % CHUNK === CHUNK - 1) { const n = c.slice(); n[k]++; add(n); }
    }
  }

  private flushChunks() {
    const g = editor.grid;
    const maxZ = Math.min(this.maxZ, g.sz - 1);
    for (const key of this.dirtyChunks) {
      const cx = key % 8, cy = Math.floor(key / 8) % 8, cz = Math.floor(key / 64);
      const old = this.chunks.get(key);
      if (old) {
        old.geometry.dispose();
        this.chunkGroup.remove(old);
        this.chunks.delete(key);
      }
      const data = buildChunk(g, this.rgb, cx, cy, cz, maxZ);
      if (!data) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      this.chunks.set(key, mesh);
      this.chunkGroup.add(mesh);
    }
    this.dirtyChunks.clear();
  }

  // ---------------------------------------------------------------- view state

  /** Hides voxels above `layer` (layer mode), or shows all with null. */
  setLayer(layer: number | null) {
    const g = editor.grid;
    const next = layer === null ? Infinity : layer;
    if (next !== this.maxZ) {
      const lo = Math.min(next, this.maxZ, g.sz - 1);
      const hi = Math.min(Math.max(next, this.maxZ), g.sz - 1);
      const [nx, ny, nz] = this.chunkCounts();
      for (let cz = Math.floor(lo / CHUNK); cz <= Math.min(nz - 1, Math.floor((hi + 1) / CHUNK)); cz++)
        for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) this.dirtyChunks.add(cx + 8 * (cy + 8 * cz));
      this.maxZ = next;
    }
    this.slicePlane.visible = layer !== null;
    if (layer !== null) {
      this.slicePlane.scale.set(g.sx, g.sy, 1);
      this.slicePlane.position.set(g.sx / 2, g.sy / 2, layer + 0.002);
    }
    this.requestRender();
  }

  setMirror(m: { x: boolean; y: boolean; z: boolean }) {
    this.mirrorPlanes.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.mirrorPlanes.clear();
    const g = editor.grid;
    const mat = new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    const add = (w: number, h: number, pos: Vec3, rot: [number, number, number]) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      p.position.set(...pos);
      p.rotation.set(...rot);
      this.mirrorPlanes.add(p);
    };
    if (m.x) add(g.sz, g.sy, [g.sx / 2, g.sy / 2, g.sz / 2], [0, Math.PI / 2, 0]);
    if (m.y) add(g.sx, g.sz, [g.sx / 2, g.sy / 2, g.sz / 2], [Math.PI / 2, 0, 0]);
    if (m.z) add(g.sx, g.sy, [g.sx / 2, g.sy / 2, g.sz / 2], [0, 0, 0]);
    this.requestRender();
  }

  setHighlight(cells: Vec3[]) {
    if (this.highlightMesh) {
      this.highlightMesh.geometry.dispose();
      this.scene.remove(this.highlightMesh);
      this.highlightMesh = null;
    }
    if (cells.length) {
      const box = new THREE.BoxGeometry(1.08, 1.08, 1.08).toNonIndexed();
      const src = box.getAttribute('position').array as Float32Array;
      const list = cells.slice(0, 20000);
      const pos = new Float32Array(list.length * src.length);
      list.forEach(([x, y, z], k) => {
        for (let i = 0; i < src.length; i += 3) {
          pos[k * src.length + i] = src[i] + x + 0.5;
          pos[k * src.length + i + 1] = src[i + 1] + y + 0.5;
          pos[k * src.length + i + 2] = src[i + 2] + z + 0.5;
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.highlightMesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: COLORS.highlight, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }),
      );
      this.highlightMesh.renderOrder = 8;
      this.scene.add(this.highlightMesh);
    }
    this.requestRender();
  }

  private buildGuides() {
    this.guides.traverse((o) => { if (o instanceof THREE.LineSegments) o.geometry.dispose(); });
    this.guides.clear();
    const g = editor.grid;
    const minor: number[] = [];
    const major: number[] = [];
    for (let x = 0; x <= g.sx; x++) (x % 8 === 0 || x === g.sx ? major : minor).push(x, 0, 0, x, g.sy, 0);
    for (let y = 0; y <= g.sy; y++) (y % 8 === 0 || y === g.sy ? major : minor).push(0, y, 0, g.sx, y, 0);
    const lines = (pts: number[], color: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
    };
    this.guides.add(lines(minor, COLORS.grid), lines(major, COLORS.gridMajor));
    const { sx, sy, sz } = g;
    const b = [
      0, 0, sz, sx, 0, sz, sx, 0, sz, sx, sy, sz, sx, sy, sz, 0, sy, sz, 0, sy, sz, 0, 0, sz,
      0, 0, 0, 0, 0, sz, sx, 0, 0, sx, 0, sz, sx, sy, 0, sx, sy, sz, 0, sy, 0, 0, sy, sz,
    ];
    this.guides.add(lines(b, COLORS.bounds));
    // Axis hints: X red, Y green along the floor edges.
    const ax = lines([0, 0, 0.01, Math.min(sx, 4), 0, 0.01], 0xe53935);
    const ay = lines([0, 0, 0.01, 0, Math.min(sy, 4), 0.01], 0x43a047);
    this.guides.add(ax, ay);
    this.setMirror(app.mirror);
  }

  /** Points the camera at the whole model from a pleasant 3/4 angle. */
  frame() {
    this.cancelSnap();
    const g = editor.grid;
    const target = new THREE.Vector3(g.sx / 2, g.sy / 2, Math.min(g.sz, Math.max(g.sx, g.sy)) / 4);
    const diag = Math.hypot(g.sx, g.sy, g.sz);
    // From the front-right-top (+X, -Y, +Z), the usual CAD home view.
    const dir = new THREE.Vector3(0.55, -1, 0.75).normalize();
    this.camera.position.copy(target).addScaledVector(dir, diag * 1.55 + 4);
    this.controls.target.copy(target);
    this.controls.update();
    this.requestRender();
    this.onCamera?.(this.camera.quaternion);
  }

  /** Current camera orientation (a copy). */
  orientation(): THREE.Quaternion {
    return this.camera.quaternion.clone();
  }

  /** Smoothly orbits the camera to look at the target from direction `dir`, keeping the distance. */
  viewFrom(dir: Vec3) {
    this.cancelSnap();
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const dist = offset.length();
    const from = offset.normalize();
    const to = new THREE.Vector3(...dir).normalize();
    // Straight up/down is degenerate with a Z-up camera; lean slightly toward -Y so Front stays at the bottom.
    if (Math.abs(to.z) > 0.9999) to.set(0, -1e-3, Math.sign(to.z)).normalize();
    const full = new THREE.Quaternion().setFromUnitVectors(from, to);
    const step = new THREE.Quaternion();
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 250);
      step.identity().slerp(full, 1 - (1 - t) ** 3);
      this.camera.position.copy(from).applyQuaternion(step).multiplyScalar(dist).add(target);
      this.controls.update();
      this.snapRaf = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    this.snapRaf = requestAnimationFrame(tick);
  }

  private cancelSnap() {
    if (this.snapRaf) cancelAnimationFrame(this.snapRaf);
    this.snapRaf = 0;
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      if (this.dirtyChunks.size) this.flushChunks();
      this.renderer.render(this.scene, this.camera);
    });
  }

  // ---------------------------------------------------------------- input

  private ray(e: PointerEvent): { o: Vec3; d: Vec3 } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }

  private hit(e: PointerEvent): RayHit | null {
    const { o, d } = this.ray(e);
    return raycast(editor.grid, o, d, Math.min(this.maxZ, editor.grid.sz - 1));
  }

  /**
   * Cell in layer `axis = coord` under the pointer, found by intersecting the ray with
   * the plane of the face the drag started on (`plane`), so it matches what was clicked.
   * With `clamp`, positions outside the grid snap to its border; otherwise they return null.
   */
  private planeCell(e: PointerEvent, axis: number, plane: number, coord: number, clamp: boolean): Vec3 | null {
    const { o, d } = this.ray(e);
    const t = rayPlane(o, d, axis, plane);
    if (t === null) return null;
    const c = [0, 1, 2].map((k) => (k === axis ? coord : Math.floor(o[k] + d[k] * t))) as Vec3;
    const g = editor.grid;
    const dims = [g.sx, g.sy, g.sz];
    for (let k = 0; k < 3; k++) {
      if (c[k] < 0 || c[k] >= dims[k]) {
        if (!clamp) return null;
        c[k] = Math.max(0, Math.min(dims[k] - 1, c[k]));
      }
    }
    return c;
  }

  private onDown(e: PointerEvent) {
    this.cancelSnap();
    if (e.button !== 0 || this.orbitHeld) return;
    const hit = this.hit(e);
    const tool = app.tool;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    if (!hit) return;
    const axis = hit.normal.findIndex((v) => v !== 0);
    // Plane of the clicked face (the floor is z = 0).
    const plane = hit.cell ? hit.cell[axis] + (hit.normal[axis] > 0 ? 1 : 0) : 0;
    switch (tool) {
      case 'place':
        if (!hit.place) return;
        editor.beginStroke();
        this.drag = { kind: 'stroke', mode: 'add', axis, plane, coord: hit.place[axis] };
        editCells([hit.place], 'add');
        break;
      case 'erase':
      case 'paint':
        if (!hit.cell) return;
        editor.beginStroke();
        // Dragging stays on the starting layer, so erasing doesn't dig into the model.
        this.drag = { kind: 'stroke', mode: tool === 'erase' ? 'erase' : 'paint', axis, plane, coord: hit.cell[axis] };
        editCells([hit.cell], this.drag.mode);
        break;
      case 'pick':
        if (hit.cell) pickAt(hit.cell);
        break;
      case 'fill':
        if (hit.cell) fillAt(hit.cell);
        break;
      case 'box': {
        const mode = app.boxMode;
        const start = mode === 'add' ? hit.place : hit.cell;
        if (!start) return;
        // Add grows outward from the clicked face; erase/paint go into the model.
        const sign = (mode === 'add' ? 1 : -1) * hit.normal[axis];
        this.drag = { kind: 'box', mode, start, end: start, axis, plane, sign };
        this.updateBoxPreview();
        break;
      }
    }
    // Refresh the hover ghost after a one-shot edit (pick/fill). Drags update on the next move.
    if (!this.drag) this.onMove(e);
  }

  private onMove(e: PointerEvent) {
    const drag = this.drag;
    if (drag?.kind === 'box') {
      const c = this.planeCell(e, drag.axis, drag.plane, drag.start[drag.axis], true);
      if (c) {
        drag.end = c;
        this.updateBoxPreview();
      }
      app.hover = drag.end;
      return;
    }
    if (drag?.kind === 'stroke') {
      const c = this.planeCell(e, drag.axis, drag.plane, drag.coord, false);
      if (c) editCells([c], drag.mode);
      this.showTarget(c);
      return;
    }
    const hit = this.orbitHeld ? null : this.hit(e);
    const placing = app.tool === 'place' || (app.tool === 'box' && app.boxMode === 'add');
    this.showTarget(hit ? (placing ? hit.place : hit.cell) : null);
  }

  private onUp(e: PointerEvent) {
    const drag = this.drag;
    this.drag = null;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (!drag) return;
    if (drag.kind === 'stroke') editor.endStroke();
    if (drag.kind === 'box') {
      this.boxPreview.visible = false;
      editCells(boxRegion(drag.start, drag.end, drag.axis, drag.sign, app.boxHeight), drag.mode);
      this.requestRender();
    }
  }

  private updateBoxPreview() {
    const d = this.drag;
    if (d?.kind !== 'box') return;
    const cells = boxRegion(d.start, d.end, d.axis, d.sign, app.boxHeight);
    if (!cells.length) return;
    const lo = cells[0], hi = cells[cells.length - 1];
    const size = [0, 1, 2].map((k) => hi[k] - lo[k] + 1);
    this.boxPreview.scale.set(size[0] + 0.04, size[1] + 0.04, size[2] + 0.04);
    this.boxPreview.position.set(lo[0] + size[0] / 2, lo[1] + size[1] / 2, lo[2] + size[2] / 2);
    const mat = this.boxPreview.material as THREE.MeshBasicMaterial;
    mat.color.setHex(d.mode === 'erase' ? COLORS.erase : editor.palette[app.color] ?? COLORS.place);
    this.boxPreview.visible = true;
    this.showTarget(null);
    this.requestRender();
  }

  private showTarget(cell: Vec3 | null) {
    app.hover = cell;
    const cells = cell ? mirrorCells(editor.grid, [cell], app.mirror) : [];
    const tool = app.tool;
    const color = tool === 'erase' || (tool === 'box' && app.boxMode === 'erase') ? COLORS.erase
      : tool === 'place' || tool === 'box' ? COLORS.place : COLORS.other;
    this.ghosts.forEach((g, i) => {
      const c = cells[i];
      g.visible = !!c;
      if (c) {
        g.position.set(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
        (g.material as THREE.LineBasicMaterial).color.setHex(color);
        (g.material as THREE.LineBasicMaterial).opacity = i === 0 ? 1 : 0.5;
      }
    });
    this.requestRender();
  }

  private setOrbitHeld(held: boolean) {
    if (held === this.orbitHeld) return;
    this.orbitHeld = held;
    this.controls.mouseButtons.LEFT = held ? THREE.MOUSE.ROTATE : null;
    this.renderer.domElement.style.cursor = held ? 'grab' : '';
    if (held) this.showTarget(null);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (e.code === 'Space' || e.key === 'Alt') {
      if (e.code === 'Space' || e.key === 'Alt') e.preventDefault();
      if (!this.drag) this.setOrbitHeld(down);
    }
  }
}
