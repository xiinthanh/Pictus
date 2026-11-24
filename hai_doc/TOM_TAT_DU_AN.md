# Tóm tắt dự án Pictus

_Ngày viết: 24/11/2026 — đọc toàn bộ mã nguồn (≈4.500 dòng, 84 file trong git)._

## 1. Pictus là gì?

Phần mềm Windows nhỏ gọn để **dựng mô hình 3D dạng "pixel khối" (voxel)** rồi **xuất file để in 3D**.

- Vẽ bằng các khối lập phương nhỏ (mặc định 1 voxel = 1 mm), lưới tối đa 128 × 128 × 128.
- Nhập ảnh pixel art (PNG) → tự đắp nổi thành móc khoá / bảng tên.
- Xuất **3MF** (mỗi màu một phần, dùng cho máy in nhiều màu), **STL**, **OBJ**.
- Có chức năng **kiểm tra trước khi in**: tìm phần rời, chỗ chỉ chạm cạnh/góc và tự sửa.
- **Cho AI (Claude Code) vẽ giúp** qua MCP: bấm nút Connect AI, AI vẽ đến đâu thấy ngay đến đó (nhánh `feat/mcp`).

Mục tiêu (GOAL.md): chạy mượt trên laptop thường, dễ dùng, chỉ giữ tính năng cần thiết.

## 2. Công nghệ

| Phần | Công nghệ |
| --- | --- |
| Vỏ ứng dụng desktop | **Tauri 2** (Rust) — đọc/ghi file, nhận file khi mở bằng double-click, và trạm trung chuyển MCP (`tiny_http`, chỉ nghe 127.0.0.1) |
| Giao diện | **Svelte 5** + SvelteKit (chế độ SPA) + TypeScript + Vite |
| Hiển thị 3D | **Three.js** |
| Nén / zip | fflate |
| Kiểm thử, chất lượng code | Vitest, ESLint, Prettier; `cargo test` cho Rust |

Gần như toàn bộ logic viết bằng TypeScript; Rust khoảng 430 dòng (trong đó ~350 dòng là trạm trung chuyển MCP, kể cả test).

## 3. Cấu trúc thư mục

```
Pictus/
├─ GOAL.md, PLAN.md            mục tiêu và kế hoạch (7 mốc M1–M7)
├─ IMPLEMENTATION_DOC.md       tình trạng triển khai (tiếng Anh)
├─ src/
│  ├─ routes/+page.svelte      bố cục chính, phím tắt, tiêu đề cửa sổ, hỏi lưu khi đóng
│  └─ lib/
│     ├─ core/                 LÕI — TypeScript thuần, không phụ thuộc giao diện
│     │  ├─ grid.ts            lưới voxel (mảng byte, 0 = trống, trục Z hướng lên)
│     │  ├─ palette.ts         bảng màu (tối đa 255 màu)
│     │  ├─ history.ts         hoàn tác / làm lại (tối đa 300 bước)
│     │  ├─ editor.ts          "Editor" — nơi duy nhất được sửa mô hình, phát sự kiện thay đổi
│     │  ├─ tools.ts           đối xứng X/Y/Z, tô loang, hộp, đường thẳng
│     │  ├─ raycast.ts         dò tia chuột → ô voxel được trỏ
│     │  ├─ topology.ts        bảng tra 2×2×2 cho chỗ chạm cạnh/góc
│     │  ├─ mesher.ts          tạo lưới tam giác: để hiển thị & để in
│     │  ├─ analysis.ts        kiểm tra in: phần rời, chỗ chạm mỏng, tự sửa
│     │  ├─ io/                pictus.ts, vox.ts (MagicaVoxel), image.ts (PNG)
│     │  └─ export/            stl.ts, obj.ts, threemf.ts
│     ├─ render/viewport.ts    cảnh 3D: camera, khối hiển thị theo cụm 16³, xem trước
│     ├─ editing.ts            thao tác sửa dùng chung cho khung 3D và khung 2D
│     ├─ actions.ts            Mới / Mở / Lưu / Lưu thành / nhập-xuất .vox
│     ├─ state/app.svelte.ts   trạng thái ứng dụng (công cụ, màu, lớp, file đang mở…)
│     ├─ platform/files.ts     gọi hộp thoại và lệnh đọc/ghi file của Rust
│     ├─ mcp/                  giao thức MCP và các công cụ cho AI; bridge.ts nối với app
│     └─ ui/                   các thành phần giao diện (thanh menu, công cụ, hộp thoại…)
├─ src-tauri/                  vỏ Rust (src/mcp.rs = trạm MCP), cấu hình cửa sổ, bộ cài, icon
└─ tests/                      kiểm thử cho core/ và mcp/
```

**Luồng dữ liệu:** người dùng thao tác (ui / viewport) → `editing.ts` → `Editor` sửa lưới và ghi lịch sử → phát sự kiện → khung 3D vẽ lại đúng các cụm bị đổi, giao diện cập nhật.

## 4. Tính năng chính

**Công cụ vẽ** (phím 1–6): Đặt, Xoá, Tô màu, Hút màu, Tô loang, Hộp (kéo chữ nhật để thêm/xoá/tô nhiều khối).
Kèm đối xứng X/Y/Z, Ctrl+Z / Ctrl+Y.

**Thanh công cụ kéo thả:** kéo tay nắm ⋮⋮ để gắn vào cạnh Trái / Phải / Trên / Dưới (Trên, Dưới thì xếp ngang) hoặc thả ở giữa cho nổi. Có chế độ chỉ icon; nhấp đúp tay nắm để về mặc định (cạnh trên); vị trí được nhớ sau khi tắt app. Chi tiết: `hai_doc/KE_HOACH_TOOLBAR_KEO_THA.md`.

**Chế độ lớp (phím L):** khung 2D vẽ từng lớp Z, lớp dưới hiện mờ; trong 3D ẩn các lớp phía trên. PgUp/PgDn đổi lớp.

**Chuột trong 3D:** trái = dùng công cụ, phải = xoay, giữa = kéo, cuộn = thu phóng, F = căn khung nhìn.

**File:**
- `.pictus` (định dạng riêng): phần đầu (kích thước, cỡ voxel, bảng màu) + dữ liệu voxel nén deflate.
- `.vox` (MagicaVoxel): nhập và xuất.
- PNG: thu gọn màu (median cut), tuỳ chọn tấm đế (theo viền hoặc chữ nhật) và lỗ móc khoá.
- Danh sách file gần đây, hỏi lưu khi có thay đổi, mở bằng double-click file `.pictus`.

**Xuất để in:** chọn định dạng, cỡ voxel (mm), gộp màu hay tách màu.

**Kiểm tra in:** đếm phần rời (nối theo mặt), tìm chỗ chỉ chạm cạnh/góc, bấm để tô sáng, tự sửa bằng cách lấp ô trống với màu lân cận (hoàn tác được).

**AI vẽ giúp (Claude Code):** bấm **Connect AI** trên thanh menu. Lần đầu, dán lệnh app đã chép sẵn vào terminal (chỉ một lần). Sau đó mở Claude Code và chat, ví dụ "vẽ cây nấm đỏ trắng cao 12 khối rồi kiểm tra in". AI có 10 công cụ (đọc mô hình, đọc một lớp, vẽ ô, tô hộp, đổi màu, mô hình mới, hoàn tác, kiểm tra in, sửa chỗ chạm mỏng, chụp ảnh khung 3D). Mỗi lệnh của AI là một bước Ctrl+Z; AI không mở, lưu hay xuất file. Chi tiết: `hai_doc/KE_HOACH_A2_MCP.md`.

Phím tắt khác: Ctrl+N mới, Ctrl+O mở, Ctrl+S lưu, Ctrl+Shift+S lưu thành, Ctrl+E xuất, Ctrl+I nhập ảnh.

## 5. Điểm kỹ thuật đáng chú ý

1. **Lưới in kín nước (watertight):** gộp các mặt phẳng liền nhau thành hình chữ nhật, nhưng vẫn giữ đỉnh ở mỗi bước 1 đơn vị trên cạnh và chia tam giác hình quạt từ tâm → không có "T-junction" khiến phần mềm cắt lớp báo lỗi hở.
2. **Chỗ chạm cạnh/góc:** tách đỉnh theo từng "tấm" để mọi cạnh được đúng 2 tam giác dùng chung.
3. **Nhiều màu:** mỗi màu là một khối kín riêng; trong 3MF chúng là các phần của cùng một vật thể → Bambu Studio / Orca / PrusaSlicer gán filament theo phần.
4. **Hiển thị nhẹ:** chỉ vẽ lại khi có thay đổi; chỉ dựng lại các cụm 16³ bị sửa; bóng đổ nướng sẵn vào màu đỉnh nên không cần đèn.
5. **Ghi file qua Rust:** dữ liệu nhị phân gửi thẳng, đường dẫn mã hoá hex trong header để an toàn với ký tự tiếng Việt / Unicode.

## 6. Tình trạng hiện tại

| Hạng mục | Trạng thái |
| --- | --- |
| Mã cho 7 mốc M1–M7 | Đã viết xong |
| Git | Nhánh `master` + nhánh `feat/mcp` (tính năng AI/MCP), chưa push |
| Unit test | 175/175 đạt; lint, format đạt (24/11/2026) |
| Kiểm tra kiểu (`pnpm check`) | 0 lỗi, 0 cảnh báo (24/11/2026) |
| Hiệu năng (mô hình 128³ dày đặc) | Dựng lại toàn bộ khung 3D ~0,2 s; lưới xuất ~2,3–2,9 s; kiểm tra in ~0,24 s |
| Biên dịch Rust (`cargo build`, `cargo test`) | Đạt, 10/10 test (24/11/2026), dùng MSVC 14.51 của Visual Studio Community 2026 |
| Chạy app (`pnpm tauri dev`) | Chạy được; đã dùng nhiều khi làm MCP, chưa thử tay toàn bộ |
| Bộ cài (`pnpm tauri build`) | Chưa làm |
| Thử file xuất trong phần mềm cắt lớp | Chưa làm |

> IMPLEMENTATION_DOC.md đã được cập nhật lại cho đúng tình trạng (24/11/2026).

## 7. Vấn đề phát hiện khi đọc hôm nay

- **Đã xử lý — `pnpm install` từng bị chặn:** chính sách an toàn của pnpm từ chối gói `tinybench@6.2.5` (gói phụ của vitest) vì mới phát hành 23/11/2026. Đã ghim `tinybench: 6.2.4` trong `pnpm-workspace.yaml` (vitest cần `^6.2.3`) và tạo lại `pnpm-lock.yaml`; các gói khác giữ nguyên phiên bản. Khi 6.2.5 đủ "tuổi" có thể bỏ dòng ghim này.
- **Đã xử lý — trình biên dịch C++:** Build Tools 2022 không còn trên máy, nên lệnh `setup.exe modify --installPath ...\2022\BuildTools` trong IMPLEMENTATION_DOC.md báo "cannot be found". Không cần lệnh đó: Visual Studio Community 2026 (`C:\Program Files\Microsoft Visual Studio\18\Community`) đã có sẵn MSVC và Windows SDK 10.0.26100, Rust build và test đều đạt.

## 8. Hạn chế đã biết

- Đổi màu trong bảng màu → dựng lại toàn bộ, có thể giật ở mô hình 128³.
- Xuất file chạy trên luồng chính → giao diện đứng vài giây với mô hình lớn (có thể chuyển sang Web Worker).
- Chưa xoá được màu; sửa bảng màu không hoàn tác được.
- Công cụ Hộp trong khung 2D chỉ trong một lớp.
- Mở file `.pictus` khi app đang chạy sẽ mở thêm cửa sổ thứ hai.
- CSP đang tắt (`null`).
- STL không giữ nhận dạng đỉnh → chỗ chạm cạnh/góc có thể bị slicer gộp; nên dùng nút sửa hoặc xuất 3MF.

## 9. Việc nên làm tiếp

1. ~~Cài thư viện, chạy `pnpm test` và `pnpm check`~~ — xong ngày 24/11/2026.
2. Chạy `pnpm tauri dev` và thử tay theo danh sách trong PLAN.md.
3. `pnpm tauri build` → thử bộ cài, double-click file `.pictus`, gỡ cài đặt.
4. Mở file xuất trong PrusaSlicer / Bambu / Orca để kiểm tra.
5. ~~Cập nhật lại IMPLEMENTATION_DOC.md cho đúng tình trạng git~~ — xong ngày 24/11/2026.
6. Thử nút Connect AI trên bản cài đặt; quyết định gộp nhánh `feat/mcp` vào `master`.
