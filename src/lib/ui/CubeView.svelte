<script lang="ts">
  import * as THREE from 'three';
  import type { Vec3 } from '$lib/core/grid';
  import type { Viewport } from '$lib/render/viewport';

  let { view }: { view: Viewport | null } = $props();

  /** Cube face: outward normal, in-plane right (u) and up (v) axes as seen from outside, label. */
  type Face = { n: Vec3; u: Vec3; v: Vec3; label: string };
  // World is Z-up; Front looks from -Y, Right from +X. Each u × v = n.
  const FACES: Face[] = [
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], label: 'Front' },
    { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1], label: 'Back' },
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], label: 'Right' },
    { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1], label: 'Left' },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], label: 'Top' },
    { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0], label: 'Bottom' },
  ];
  const AXES = [
    { k: 0, label: 'X', color: '#e53935' },
    { k: 1, label: 'Y', color: '#43a047' },
    { k: 2, label: 'Z', color: '#1e88e5' },
  ];
  /** SVG units per cube half-size; the viewBox is 100 wide. */
  const S = 24;
  const SPLIT = [-1, -0.6, 0.6, 1];
  const BAND = [-1, 0, 1];

  const comb = (n: Vec3, u: Vec3, v: Vec3, s: number, t: number): Vec3 => [
    n[0] + u[0] * s + v[0] * t,
    n[1] + u[1] * s + v[1] * t,
    n[2] + u[2] * s + v[2] * t,
  ];

  function dirName(d: Vec3) {
    const parts: string[] = [];
    if (d[1]) parts.push(d[1] < 0 ? 'Front' : 'Back');
    if (d[0]) parts.push(d[0] > 0 ? 'Right' : 'Left');
    if (d[2]) parts.push(d[2] > 0 ? 'Top' : 'Bottom');
    return parts.join('-');
  }

  /** Each face split 3×3: centre = face view, sides = edge views, corners = corner views. */
  type Cell = { corners: Vec3[]; dir: Vec3; key: string; name: string };
  const CELLS: Cell[][] = FACES.map(({ n, u, v }) => {
    const cells: Cell[] = [];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const [s0, s1, t0, t1] = [SPLIT[i], SPLIT[i + 1], SPLIT[j], SPLIT[j + 1]];
        const dir = comb(n, u, v, BAND[i], BAND[j]);
        cells.push({
          corners: [comb(n, u, v, s0, t0), comb(n, u, v, s1, t0), comb(n, u, v, s1, t1), comb(n, u, v, s0, t1)],
          dir,
          key: dir.join(','),
          name: dirName(dir),
        });
      }
    return cells;
  });

  let q = $state.raw(new THREE.Quaternion());
  let hover = $state<string | null>(null);

  $effect(() => {
    const v = view;
    if (!v) return;
    q = v.orientation();
    const fn = (nq: THREE.Quaternion) => (q = nq.clone());
    v.onCamera = fn;
    return () => {
      if (v.onCamera === fn) v.onCamera = null;
    };
  });

  /** Camera basis in world space: screen right, screen up, and toward the viewer. */
  const basis = $derived.by(() => {
    const vec = (x: number, y: number, z: number) => {
      const w = new THREE.Vector3(x, y, z).applyQuaternion(q);
      return [w.x, w.y, w.z] as Vec3;
    };
    return { right: vec(1, 0, 0), up: vec(0, 1, 0), back: vec(0, 0, 1) };
  });

  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** Orthographic projection to SVG coordinates (y down). */
  const px = (p: Vec3) => dot(p, basis.right) * S;
  const py = (p: Vec3) => -dot(p, basis.up) * S;
  const pts = (ps: Vec3[]) => ps.map((p) => `${px(p).toFixed(2)},${py(p).toFixed(2)}`).join(' ');

  const visible = $derived(
    FACES.map((f, i) => ({ f, i, facing: dot(f.n, basis.back) })).filter((x) => x.facing > 0.02),
  );

  /** Maps label space (100 units across a face, y down) onto the projected face. */
  function labelMatrix({ n, u, v }: Face) {
    const k = 1 / 50;
    const a = px(u) * k, b = py(u) * k, c = -px(v) * k, d = -py(v) * k;
    return `matrix(${[a, b, c, d, px(n), py(n)].map((x) => x.toFixed(4)).join(' ')})`;
  }

  /** Axis triad along the cube edges from the (-1,-1,-1) corner. */
  const axes = $derived(
    AXES.map(({ k, label, color }) => {
      const o: Vec3 = [-1, -1, -1];
      const end = o.slice() as Vec3;
      end[k] = 1.45;
      const tip = o.slice() as Vec3;
      tip[k] = 1.75;
      // The edge is in front when either face that shares it is visible (their normals are -e_j, j ≠ k).
      const front = [0, 1, 2].some((j) => j !== k && basis.back[j] < -0.02);
      return { label, color, front, o, end, tip };
    }),
  );

  function go(dir: Vec3) {
    view?.viewFrom(dir);
  }
</script>

{#snippet axis(a: (typeof axes)[number])}
  <line class="axis" x1={px(a.o)} y1={py(a.o)} x2={px(a.end)} y2={py(a.end)} stroke={a.color} />
  <text class="axis-label" x={px(a.tip)} y={py(a.tip)} fill={a.color}>{a.label}</text>
{/snippet}

<svg class="cube" viewBox="-50 -50 100 100" role="group" aria-label="View cube" onpointerleave={() => (hover = null)}>
  {#each axes as a (a.label)}
    {#if !a.front}{@render axis(a)}{/if}
  {/each}
  {#each visible as { f, i, facing } (i)}
    <g style:opacity={Math.min(1, facing * 6)}>
      {#each CELLS[i] as c (c.key)}
        <polygon
          class="cell"
          class:hover={hover === c.key}
          points={pts(c.corners)}
          role="button"
          tabindex="-1"
          aria-label={`View from ${c.name}`}
          onpointerenter={() => (hover = c.key)}
          onclick={() => go(c.dir)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && go(c.dir)}
        >
          <title>{c.name}</title>
        </polygon>
      {/each}
      <polygon class="outline" points={pts([comb(f.n, f.u, f.v, -1, -1), comb(f.n, f.u, f.v, 1, -1), comb(f.n, f.u, f.v, 1, 1), comb(f.n, f.u, f.v, -1, 1)])} />
      <text class="label" transform={labelMatrix(f)}>{f.label}</text>
    </g>
  {/each}
  {#each axes as a (a.label)}
    {#if a.front}{@render axis(a)}{/if}
  {/each}
</svg>

<style>
  .cube {
    width: 110px;
    height: 110px;
    overflow: visible;
    user-select: none;
    pointer-events: none;
  }
  .cell {
    fill: rgba(39, 43, 51, 0.92);
    stroke: none;
    pointer-events: all;
    cursor: pointer;
    outline: none;
  }
  .cell.hover {
    fill: var(--accent);
  }
  .outline {
    fill: none;
    stroke: #5a5f6b;
    stroke-width: 0.8;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .label {
    fill: var(--text);
    font-size: 24px;
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .axis {
    stroke-width: 1.6;
    stroke-linecap: round;
    pointer-events: none;
  }
  .axis-label {
    font-size: 9px;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
</style>
