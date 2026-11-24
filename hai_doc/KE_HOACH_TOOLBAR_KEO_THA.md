# Kế hoạch: Thanh công cụ kéo thả, gắn được nhiều nơi

_Ngày viết: 25/11/2026 · Trạng thái: **đã duyệt, đã code** trên nhánh `feat/toolbar-dock`, chờ kiểm tra tay và xác nhận commit._

## 1. Mục tiêu

Hiện thanh công cụ (`Toolbar.svelte`) bị cố định ở cạnh trái, xếp dọc, rộng 92px. Sau khi làm xong:

1. Người dùng **kéo tay nắm ⋮⋮** để chuyển thanh công cụ sang cạnh **Trái / Phải / Trên / Dưới**, hoặc để nó **nổi** ở bất kỳ đâu.
2. Gắn ở cạnh Trên hoặc Dưới thì thanh công cụ **tự xếp ngang**.
3. Có chế độ **chỉ hiện icon** cho gọn.
4. **Nhấp đúp** vào tay nắm để đưa về mặc định (cạnh trên, có chữ).
5. Vị trí và chế độ **được nhớ** sau khi tắt app.

**Không làm trong đợt này:** menu View, thu gọn panel phải, bảng phím tắt, tooltip mới. Đây là các mục A–G ở Phần 2, làm sau nếu bạn duyệt.

---

## 2. Người dùng sẽ thấy gì

### 2.1 Bố cục mới

```
┌──────────────── MenuBar ────────────────┐
├──────────── [cạnh Trên] ────────────────┤  ← thanh ngang, rộng hết cửa sổ
│[Trái]│        Viewport        │[Phải]│SidePanel│
├──────────── [cạnh Dưới] ───────────────┤  ← thanh ngang, rộng hết cửa sổ
└──────────────── StatusBar ──────────────┘
```

- **Phải** nghĩa là giữa Viewport và SidePanel. SidePanel luôn ở mép phải ngoài cùng.
- **Trên/Dưới** rộng hết cửa sổ, nằm giữa MenuBar và StatusBar.
- **Nổi**: thanh dọc, có bóng đổ và bo góc, nằm đè lên vùng làm việc (vùng giữa MenuBar và StatusBar).

### 2.2 Thao tác kéo

| Bước | Hành vi |
|---|---|
| Nhấn chuột trái vào tay nắm ⋮⋮ | Chưa có gì xảy ra. Phải rê **quá 4px** mới tính là kéo, để không lẫn với nhấp đúp. |
| Bắt đầu kéo | 4 cạnh vùng làm việc hiện **dải thả mờ**. Một **khung mờ** cùng cỡ thanh công cụ chạy theo chuột. |
| Rê vào gần một cạnh (≤ 56px) | Dải của cạnh đó sáng lên (màu accent). Gần hai cạnh cùng lúc (ở góc) thì chọn cạnh gần hơn. |
| Rê ra ngoài vùng làm việc (lên MenuBar…) | Coi như cạnh gần nhất. |
| Thả chuột trên một dải | Thanh công cụ gắn vào cạnh đó. |
| Thả chuột ở giữa | Thanh công cụ nổi, góc trên-trái đặt đúng chỗ khung mờ. |
| Nhấn **Esc** khi đang kéo | Huỷ kéo, mọi thứ giữ nguyên. Esc lúc này **không** xoá highlight như bình thường. |
| Mất chuột (pointercancel, cửa sổ mất focus) | Huỷ kéo như Esc. |

Thanh công cụ **không di chuyển** trong lúc kéo, chỉ khung mờ di chuyển. Nhờ vậy viewport 3D không phải đổi kích thước liên tục.

### 2.3 Khi đang nổi

- Vị trí luôn được **giữ trong vùng làm việc**. Cửa sổ thu nhỏ lại thì thanh công cụ tự lùi vào trong, không bao giờ bị mất khỏi màn hình.
- Vị trí đã lưu **không bị ghi đè** khi thu nhỏ cửa sổ. Phóng to lại thì thanh công cụ về chỗ cũ.
- Thanh công cụ cao hơn vùng làm việc thì có thanh cuộn dọc.

### 2.4 Xếp ngang (cạnh Trên/Dưới)

```
⋮⋮ │ [Place][Erase][Paint][Pick][Fill][Box] │ BOX Add|Erase|Paint  H[1] │ MIRROR X|Y|Z │ LAYER [On] − 3/16 + │ ⇤
```

- Các nhóm (Box, Mirror, Layer view) xếp ngang, ngăn cách bằng vạch dọc thay vì vạch ngang.
- Cửa sổ hẹp quá thì có thanh cuộn ngang. Không ẩn công cụ nào.

### 2.5 Chế độ chỉ icon

- Nút ở cuối thanh công cụ dùng để chuyển giữa "có chữ" và "chỉ icon".
- Khi chỉ icon: nút công cụ ẩn chữ, thanh dọc thu từ 92px còn **khoảng 56px**. Tên công cụ vẫn hiện khi rê chuột qua (thuộc tính `title`, giữ như hiện nay).
- Các nhóm Box, Mirror và Layer vẫn hiện đủ. Nút không vừa chiều ngang thì tự xuống dòng (`flex-wrap` đã có).

### 2.6 Tay nắm

- Là một `<button>` có `aria-label="Move toolbar"` và `title="Drag to move · Double-click to reset"`, chữ tiếng Anh như phần còn lại của app.
- Con trỏ chuột đổi thành `grab`, khi đang kéo thì đổi thành `grabbing`.
- Thanh dọc: tay nắm nằm trên cùng. Thanh ngang: tay nắm nằm đầu trái.

---

## 3. Thiết kế kỹ thuật

### 3.1 Dữ liệu lưu

Khoá localStorage: `pictus.toolbar`.

```ts
export type ToolbarDock = 'left' | 'right' | 'top' | 'bottom' | 'float';

export interface ToolbarPrefs {
  dock: ToolbarDock;
  /** Vị trí khi nổi, tính bằng px từ góc trên-trái vùng làm việc. */
  floatX: number;
  floatY: number;
  isCompact: boolean;
}

export const DEFAULT_TOOLBAR_PREFS = { dock: 'top', floatX: 16, floatY: 16, isCompact: false };
```

Đọc dữ liệu (`parseToolbarPrefs`) theo đúng cách của `exportPrefs.ts`:
- Chưa lưu gì, hoặc giá trị không phải object → dùng mặc định.
- `dock` lạ → `'top'`.
- `floatX`/`floatY` không phải số hữu hạn (NaN, chuỗi, Infinity) → mặc định. Số âm → `0`. Số quá lớn **giữ nguyên**, vì lúc hiển thị mới kẹp theo cửa sổ (mục 2.3).
- `isCompact` khác `true` → `false`.
- JSON hỏng → **ném lỗi**. `loadSetting` bắt lỗi này, ghi cảnh báo và dùng mặc định. Hàm này đã có sẵn và đã có test.

Lưu (`saveSetting`) chỉ khi: thả chuột xong, đổi chế độ icon, hoặc nhấp đúp để reset. **Không** lưu liên tục trong lúc kéo. Lưu lỗi thì ghi `console.warn`, giống `saveRecent()` trong `app.svelte.ts`: bố cục vẫn đúng trong phiên này, chỉ là lần sau không nhớ.

### 3.2 Hàm thuần (test được bằng vitest)

Đặt trong `src/lib/ui/toolbarLayout.ts`. File này không dùng Svelte hay API trình duyệt.

```ts
interface Rect { left: number; top: number; width: number; height: number }

/** Cạnh mà con trỏ đang ở gần (≤ EDGE_ZONE_PX), hoặc 'float' nếu ở giữa. Ngoài vùng → cạnh gần nhất. */
export function dockAt(x: number, y: number, area: Rect): ToolbarDock;

/** Kẹp góc trên-trái của khung w×h để nó nằm trọn trong vùng areaW×areaH. Khung lớn hơn vùng → 0. */
export function clampToArea(x: number, y: number, size: { w: number; h: number }, area: { w: number; h: number }): { x: number; y: number };

export const EDGE_ZONE_PX = 56;
export const DRAG_THRESHOLD_PX = 4;
```

Viết tên hằng rõ ràng, không để số trần trong code (AGENTS.md mục 3.6).

### 3.3 Chia việc giữa các component

```
+page.svelte
 ├─ giữ phần tử vùng làm việc (.workspace) và trạng thái kéo `toolbarDrag`
 ├─ đặt <Toolbar> vào 1 trong 5 chỗ theo app.toolbar.dock
 ├─ onkeydown: nếu đang kéo → Esc huỷ, bỏ qua mọi phím tắt khác
 └─ {#if toolbarDrag}<DockZones …/>{/if}

Toolbar.svelte    — vẽ nút; xếp dọc/ngang; tay nắm báo "bắt đầu kéo" lên trang qua prop
DockZones.svelte  — 4 dải thả + khung mờ; nghe pointermove/up/cancel trên window; thả → app.setToolbar(...)
```

- `Toolbar` có thêm 2 prop: `orientation: 'vertical' | 'horizontal'` và `ongripdown: (e: PointerEvent, rect: DOMRect) => void`. Toolbar tự xử lý nhấp đúp (reset) và nút chỉ icon, vì đây chỉ là gọi `app.setToolbar`.
- `DockZones` nhận `area: HTMLElement`, `start` (vị trí chuột lúc nhấn, khoảng lệch so với góc thanh, kích thước thanh) và `onend: () => void`. Chưa vượt `DRAG_THRESHOLD_PX` thì không vẽ gì, nhả chuột lúc đó thì chỉ kết thúc, không đổi gì.
- Mỗi lần thả chỉ gọi **một lần** `app.setToolbar(...)` (cập nhật state và lưu), không ghi rải rác.
- Kéo bằng sự kiện **pointer** (`pointermove`/`pointerup`/`pointercancel` trên `window`), không dùng HTML5 drag-and-drop. Lý do: HTML5 DnD trong WebView2 hiện ảnh "bóng" mặc định khó kiểm soát và không cho kẹp vị trí.

### 3.4 Trạng thái app

Thêm vào `AppState` (`src/lib/state/app.svelte.ts`):

```ts
toolbar = $state<ToolbarPrefs>(loadSetting(TOOLBAR_PREFS_KEY, parseToolbarPrefs, { ...DEFAULT_TOOLBAR_PREFS }));

setToolbar(next: ToolbarPrefs) { this.toolbar = next; /* saveSetting, lỗi → console.warn */ }
```

Đây là trường mới trong đối tượng `app` đã có, **không** tạo biến toàn cục mới.

### 3.5 Ảnh hưởng tới phần khác

- **Viewport 3D và SliceView** đã tự theo dõi kích thước bằng `ResizeObserver` (`viewport.ts:129`, `SliceView.svelte:129`). Khi thanh công cụ đổi chỗ, chúng tự vẽ lại, không cần sửa.
- **Lúc đang kéo:** `DockZones` phủ một lớp trong suốt lên vùng làm việc, nên viewport không nhận click và không xoay camera nhầm.
- **MCP / AI:** không liên quan.
- **Phím tắt 1–6, F, L…:** giữ nguyên. Chỉ bị bỏ qua trong lúc đang kéo.

---

## 4. Danh sách file

| File | Loại | ~Dòng | Nội dung |
|---|---|---|---|
| `src/lib/ui/toolbarLayout.ts` | **mới** | ~80 | Kiểu dữ liệu, mặc định, `parseToolbarPrefs`, `dockAt`, `clampToArea`, các hằng số |
| `tests/toolbarLayout.test.ts` | **mới** | ~110 | Test cho 3 hàm trên (mục 5) |
| `src/lib/state/app.svelte.ts` | sửa | +15 | Trường `toolbar`, hàm `setToolbar` |
| `src/lib/ui/Toolbar.svelte` | sửa | +70 | Tay nắm, prop hướng xếp, CSS ngang, nút chỉ icon, nhấp đúp để reset |
| `src/lib/ui/DockZones.svelte` | **mới** | ~100 | Dải thả, khung mờ, xử lý kéo/thả/huỷ |
| `src/routes/+page.svelte` | sửa | +40 | Bọc `.workspace`, 5 chỗ đặt toolbar, trạng thái kéo, Esc khi kéo |
| `src/lib/ui/Icon.svelte` | sửa | +3 | Icon `grip` (⋮⋮), `compact`, `expand` |
| `hai_doc/TOM_TAT_DU_AN.md` | sửa | +3 | Ghi chú tính năng mới |

Tổng cộng khoảng 420 dòng, trong đó khoảng 110 dòng là test. **Không thêm thư viện mới.**

---

## 5. Test

### 5.1 Test tự động (`tests/toolbarLayout.test.ts`)

**`parseToolbarPrefs`**
- Chưa lưu gì (`null`) → mặc định.
- Đọc đúng dữ liệu hợp lệ cho cả 5 kiểu `dock`.
- `dock` lạ (`"middle"`) → `'top'`.
- Giá trị không phải object (`[]`, `42`, `"x"`) → mặc định.
- `floatX` là chuỗi, `null` hoặc `NaN` → mặc định. Số âm → `0`.
- `isCompact` là `"yes"` → `false`.
- JSON hỏng → ném lỗi.

**`dockAt`** (vùng giả định 1000 × 600)
- Giữa vùng → `'float'`.
- Cách cạnh trái 10px → `'left'`. Tương tự cho phải, trên, dưới.
- Cách cạnh đúng 56px → vẫn tính là cạnh. 57px → `'float'`. Đây là ca biên.
- Ở góc, gần trái 10px và gần trên 30px → `'left'`, vì trái gần hơn.
- Con trỏ ở ngoài vùng (y âm) → `'top'`.
- Vùng có `left`/`top` khác 0 → tính đúng theo toạ độ tương đối.

**`clampToArea`**
- Nằm trong vùng → giữ nguyên.
- Vượt phải/dưới → kéo vào cho vừa.
- Toạ độ âm → `0`.
- Khung lớn hơn vùng → `0`, không ra số âm.
- Vùng kích thước `0` → `{0, 0}`.

### 5.2 Kiểm tra tay (chạy `pnpm tauri dev`)

1. Kéo thanh công cụ vào lần lượt 4 cạnh. Ở mỗi cạnh kiểm tra: xếp đúng hướng, viewport không bị méo, các nút vẫn bấm được.
2. Thả ở giữa để thanh công cụ nổi, rồi thu nhỏ cửa sổ: thanh công cụ không bị mất. Phóng to lại: về chỗ cũ.
3. Nhấn Esc khi đang kéo: không có gì thay đổi.
4. Nhấp đúp vào tay nắm: thanh công cụ về cạnh trên, có chữ.
5. Bật chế độ chỉ icon ở cả 4 cạnh và khi nổi.
6. Tắt app rồi mở lại: thanh công cụ vẫn ở đúng vị trí và đúng chế độ.
7. Chọn công cụ Box, bật Layer view ở cả thanh ngang: các nhóm Box/Layer hiện đủ, không bị tràn.
8. Phím tắt 1–6, F, L vẫn hoạt động sau khi di chuyển thanh công cụ.

### 5.3 Lệnh kiểm chứng (AGENTS.md mục 9)

```
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
```

Phần này không sửa Rust, nên chỉ chạy `cargo test` để chắc chắn không có gì bị ảnh hưởng.

---

## 6. Các bước làm

Mỗi bước kiểm chứng xong mới sang bước tiếp theo.

1. **Hàm thuần và test:** tạo `toolbarLayout.ts` và `toolbarLayout.test.ts`. Viết test trước, thấy fail, rồi mới viết hàm.
2. **State:** thêm `toolbar` và `setToolbar` vào `app.svelte.ts`.
3. **Toolbar hai hướng:** thêm prop `orientation`, CSS ngang và chế độ chỉ icon. Chưa có kéo thả, kiểm tra bằng cách đổi giá trị mặc định tạm thời.
4. **Bố cục trang:** thêm `.workspace` và 5 chỗ đặt toolbar vào `+page.svelte`.
5. **Kéo thả:** tạo `DockZones.svelte`, thêm tay nắm, nhấp đúp và xử lý Esc.
6. **Kiểm tra tay** theo mục 5.2, chạy đủ lệnh ở mục 5.3, cập nhật `TOM_TAT_DU_AN.md`.
7. **Commit** trên nhánh mới `feat/toolbar-dock`, message: `feat: draggable, dockable toolbar`. Chỉ commit khi bạn đồng ý, và **không** push.

---

## 7. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Thanh dọc chỉ icon (~56px) quá hẹp cho nhóm Layer (`− 3/16 +`) | Cho xuống dòng, nút −/+ nằm dưới con số. Nếu vẫn xấu thì báo lại bạn, không tự đổi thiết kế. |
| Thanh ngang quá dài trên màn hình hẹp | Có cuộn ngang (mục 2.4). |
| Thanh nổi che mất phần mô hình đang vẽ | Kéo đi chỗ khác được, hoặc nhấp đúp để về cạnh trên. |
| Người dùng chỉ dùng bàn phím không kéo được | Đợt này chưa có cách khác. Đề xuất làm menu View (mục E) để chọn vị trí bằng menu. |
| `+page.svelte` dài thêm | Đẩy logic kéo sang `DockZones.svelte`. Trang chỉ còn phần đặt toolbar vào đúng chỗ. |

---

## 8. Quyết định đã chốt (25/11/2026)

1. Cạnh Trên/Dưới rộng hết cửa sổ (sơ đồ 2.1).
2. Thanh nổi luôn xếp dọc.
3. Vùng bắt cạnh 56px, ngưỡng kéo 4px.
4. Làm trên nhánh `feat/toolbar-dock` tách từ `main`. Chỉ commit sau khi bạn xác nhận, gộp thành một commit.

### Điểm khác so với kế hoạch khi code

- `Toolbar` **không** nhận prop `orientation`. Nó tự suy ra hướng từ `app.toolbar.dock`, nên chỉ còn một prop `ongripdown`.
- `clampToArea` nhận kích thước dạng object `{ w, h }` để có tối đa 4 tham số (AGENTS.md mục 3.4).
- Thêm 2 hàm thuần có test: `isPastDragThreshold` (đã vượt 4px chưa) và `floatPositionAt` (vị trí nổi khi thả).
- Vị trí mặc định đổi từ **trái** sang **trên** theo yêu cầu (25/11/2026). Người đã có thiết lập lưu sẵn vẫn giữ vị trí cũ; nhấp đúp tay nắm để về mặc định mới.
- Khung mờ **không bị kẹp** trong vùng làm việc. Nếu kẹp, khung của thanh ngang (rộng hết cửa sổ) sẽ đứng yên ở mép trái, không chạy theo chuột.

---

## 9. Câu hỏi ban đầu (đã trả lời ở mục 8)

1. **Cạnh Trên/Dưới** rộng hết cửa sổ (như sơ đồ 2.1), hay chỉ rộng bằng viewport (không đè lên SidePanel)? Tôi đề xuất **rộng hết cửa sổ**, vì đơn giản hơn và giống các app quen thuộc.
2. **Thanh nổi** luôn xếp dọc, hay cho chọn dọc/ngang? Tôi đề xuất **luôn dọc** (YAGNI). Cần thì làm sau.
3. **Vùng bắt cạnh 56px** và **ngưỡng kéo 4px** có ổn không? Hai con số này dễ chỉnh sau.
4. **Nhánh:** tạo nhánh mới `feat/toolbar-dock` từ `main`, đúng không?
