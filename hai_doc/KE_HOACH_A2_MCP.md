# Kế hoạch A2: MCP server nhúng trong Pictus

## Bối cảnh

Bạn đã chốt **phương án A2**: AI bên ngoài (Claude Code) điều khiển Pictus đang mở. AI vẽ đến đâu thấy ngay đến đó, Ctrl+Z hoàn tác được, và AI có thể chụp khung 3D để tự kiểm tra.

Mục tiêu của bản kế hoạch: liệt kê rõ file nào tạo hoặc sửa, mỗi file chứa gì, theo quy tắc nào, để bạn kiểm soát được từng bước.

**Nguyên tắc thiết kế chính: Rust chỉ làm trạm trung chuyển "câm".** Toàn bộ giao thức MCP và các công cụ viết bằng TypeScript, dùng lại `Editor` và `core/` có sẵn. Rust chỉ nhận HTTP, kiểm tra bảo mật, chuyển nguyên văn thông điệp sang giao diện rồi trả lời lại. Nhờ vậy phần Rust ngắn, ít lỗi, và logic nằm ở nơi test được bằng vitest.

```
Claude Code ──HTTP POST /mcp──▶ Rust (tiny_http, 127.0.0.1)
                                  │ kiểm tra Origin, token, kích thước
                                  │ emit "mcp-request" {id, body, protocolVersion, method, name}
                                  ▼
                         Giao diện TS: bridge.ts → protocol.ts → tools.ts → Editor
                                  │ invoke("mcp_respond", {id, status, body})
                                  ▼
Claude Code ◀──JSON trả lời────── Rust
```

## Điều chỉnh khi làm M1 (24/11/2026)

Khi đối chiếu đặc tả MCP hiện hành, tôi phát hiện bản **2026-07-28** đã thay đổi lớn: bỏ bước bắt tay `initialize`, mỗi yêu cầu tự mang phiên bản trong `params._meta`, bắt buộc có `server/discover`, và các header `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` phải khớp với nội dung (sai thì trả 400, lỗi `-32020`). Vì vậy:

1. **Server hỗ trợ cả hai thời kỳ ("dual-era")**: client mới dùng 2026-07-28, client cũ dùng `initialize` với 2025-03-26 / 2025-06-18 / 2025-11-25. Nhờ vậy Claude Code bản nào cũng kết nối được.
2. **Rust chuyển thêm 3 header trên sang TS**, còn TS quyết định luôn mã HTTP (200 / 202 / 400 / 404). Rust vẫn chỉ trung chuyển, logic vẫn test được bằng vitest.
3. **Thêm cách bật nhanh khi phát triển**: `VITE_PICTUS_MCP_TOKEN=<token ≥32 ký tự> pnpm tauri dev` tự bật kết nối với token đó. Chỉ có tác dụng ở chế độ dev, bản cài đặt không có.
4. **File trong `src/lib/mcp/` import bằng đường dẫn tương đối** (`../core/...`), không dùng `$lib`, vì vitest không hiểu `$lib`. Riêng `bridge.ts` được dùng `$lib` vì nó nối với app.
5. **Test giao thức viết luôn ở M1** (`tests/mcp.test.ts`), không đợi đến M6.

---

## Quy tắc bắt buộc (áp dụng suốt quá trình)

**Bảo mật**
1. Chỉ nghe ở `127.0.0.1`, không bao giờ `0.0.0.0`. *Mục đích:* máy khác trong mạng không gọi vào được.
2. Mọi yêu cầu phải có `Authorization: Bearer <token>` đúng, sai thì trả 401. Token là chuỗi ngẫu nhiên 32 byte, tạo bằng `crypto.getRandomValues` ở giao diện.
3. Yêu cầu có header `Origin` thì trả 403. *Mục đích:* chặn trang web độc hại trên trình duyệt gọi vào localhost. Claude Code không gửi Origin.
4. Thân yêu cầu tối đa 4 MB, vượt thì trả 413.
5. **Mặc định TẮT.** Người dùng phải tự bật trong hộp thoại AI.
6. **Bản đầu không có công cụ đọc/ghi file** (lưu, mở, xuất). AI chỉ sửa mô hình đang mở, còn lưu và xuất do người dùng tự bấm. *Mục đích:* AI không thể ghi đè hay xóa file trên ổ đĩa.

**Code**
7. `src/lib/core/` vẫn không phụ thuộc giao diện. `src/lib/mcp/tools.ts` và `protocol.ts` **không import** `app.svelte.ts` mà nhận mọi thứ qua tham số `ctx`. *Mục đích:* test được bằng vitest mà không cần Svelte.
8. Mọi thay đổi mô hình đều đi qua `Editor` (`src/lib/core/editor.ts`).
9. **Mỗi lần AI gọi một công cụ = đúng một bước hoàn tác**: bọc trong `editor.beginStroke()` / `editor.endStroke()`.
10. Người dùng đang kéo chuột vẽ (`editor.inStroke`) thì công cụ sửa trả lỗi "User is drawing, retry shortly". Không chạy chen vào.
11. Lỗi của công cụ trả về dạng `isError: true` kèm lời giải thích để AI tự sửa. Chỉ lỗi giao thức mới dùng lỗi JSON-RPC.
12. Kiểm tra mọi tham số: số nguyên, trong giới hạn lưới, màu tồn tại. Mỗi lần gọi tối đa 20.000 voxel.
13. Mô tả công cụ viết bằng tiếng Anh (để AI hiểu chính xác). Giao diện cũng tiếng Anh, giống phần còn lại của app.
14. Mỗi mốc là một commit trên nhánh `feat/mcp`, và `pnpm test`, `pnpm check`, `cargo test` phải đạt trước khi commit.

---

## Danh sách file

| File | Loại | ~Dòng | Mục đích |
|---|---|---|---|
| `src-tauri/Cargo.toml` | sửa | +1 | Thêm `tiny_http = "0.12"` |
| `src-tauri/src/mcp.rs` | **mới** | ~130 | HTTP server, bảo mật, trung chuyển |
| `src-tauri/src/lib.rs` | sửa | +5 | Đăng ký module, state, 3 lệnh |
| `src/lib/mcp/protocol.ts` | **mới** | ~80 | Xử lý JSON-RPC / MCP |
| `src/lib/mcp/tools.ts` | **mới** | ~260 | 10 công cụ, kiểm tra tham số |
| `src/lib/mcp/bridge.ts` | **mới** | ~70 | Nghe sự kiện, bật/tắt, lưu cài đặt, nối `ctx` với app |
| `src/lib/render/viewport.ts` | sửa | +15 | Thêm hàm `snapshot()` |
| `src/lib/ui/ViewportView.svelte` | sửa | +2 | Đăng ký viewport cho `bridge` |
| `src/lib/ui/AiDialog.svelte` | **mới** | ~110 | Bật/tắt, cổng, token, nút sao chép lệnh kết nối |
| `src/lib/state/app.svelte.ts` | sửa | +3 | `DialogId` thêm `'ai'`, thêm `mcpOn` |
| `src/lib/ui/MenuBar.svelte` | sửa | +3 | Nút "AI…" |
| `src/lib/ui/StatusBar.svelte` | sửa | +3 | Chấm báo "AI on" |
| `src/routes/+page.svelte` | sửa | +2 | Hiện `AiDialog`, tự bật lại nếu lần trước đang bật |
| `tests/mcp.test.ts` | **mới** | ~150 | Test giao thức và công cụ |
| `README.md`, `IMPLEMENTATION_DOC.md`, `Hai_doc/` | sửa | — | Tài liệu |

Tổng cộng khoảng 850 dòng mới, trong đó Rust chỉ khoảng 135.

---

## Chi tiết từng file

### 1. `src-tauri/src/mcp.rs` (mới)

```rust
pub struct McpState {
    running: Mutex<Option<Arc<tiny_http::Server>>>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<String>>>>,
    next_id: Arc<AtomicU64>,
}

#[tauri::command] pub fn mcp_start(app: AppHandle, state: State<McpState>, port: u16, token: String) -> Result<(), String>
#[tauri::command] pub fn mcp_stop(state: State<McpState>)
#[tauri::command] pub fn mcp_respond(state: State<McpState>, id: u64, body: String)

/// Hàm thuần, có unit test: Ok hoặc mã lỗi HTTP.
fn authorize(origin: Option<&str>, auth: Option<&str>, token: &str) -> Result<(), u16>
```

Vòng lặp của `serve()` chạy trên một luồng riêng và xử lý **lần lượt từng yêu cầu**, nên không cần lo chạy song song:
- Đường dẫn khác `/mcp` → 404. Phương thức khác POST → 405.
- `authorize` không đạt → 401 / 403. Thân quá 4 MB → 413.
- Tạo `id` mới và một kênh `mpsc`, lưu vào `pending`, rồi `app.emit_to("main", "mcp-request", {id, body})`.
- Chờ `recv_timeout(60 s)`. Hết giờ thì trả 504 "Pictus did not answer".
- Câu trả lời rỗng (thông báo, không cần đáp) → 202. Còn lại → 200 với `Content-Type: application/json`.
- `mcp_start` khi đang chạy thì dừng bản cũ rồi bật lại. Cổng bị chiếm thì trả lỗi rõ ràng.
- `mcp_stop` gọi `server.unblock()` để luồng tự kết thúc.

### 2. `src-tauri/src/lib.rs` (sửa)

```rust
mod mcp;
// trong run():
.manage(mcp::McpState::default())
.invoke_handler(tauri::generate_handler![read_file, write_file, startup_file,
                                         mcp::mcp_start, mcp::mcp_stop, mcp::mcp_respond])
```

`capabilities/default.json` đã có `core:default` (bao gồm quyền nghe sự kiện) nên dự kiến không phải sửa. Sẽ kiểm tra lại ở mốc 1.

### 3. `src/lib/mcp/protocol.ts` (mới)

```ts
export async function handleMessage(raw: string, tools: Tool[], ctx: ToolCtx): Promise<string | null>
```
- JSON lỗi → lỗi `-32700`. Không có `id` (thông báo) → trả `null`.
- `initialize` → `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'pictus', version }, instructions }`.
  - `protocolVersion`: nếu client đề nghị bản nằm trong danh sách hỗ trợ thì dùng đúng bản đó, không thì dùng bản mới nhất. Danh sách sẽ đối chiếu với đặc tả MCP lúc code.
  - `instructions`: giải thích ngắn hệ tọa độ (Z hướng lên, gốc ở góc), "màu 0 = trống", "mỗi lần gọi là một bước hoàn tác".
- `ping` → `{}`. `tools/list` → định nghĩa các công cụ.
- `tools/call` → chạy công cụ. Công cụ ném lỗi thì trả `{ content: [{type:'text', text}], isError: true }`.
- Phương thức lạ → lỗi `-32601`.

### 4. `src/lib/mcp/tools.ts` (mới)

```ts
export interface ToolCtx {
  editor: Editor;                                   // src/lib/core/editor.ts
  info(): { name: string; dirty: boolean; layer: number; color: number };
  newModel(sx: number, sy: number, sz: number): void;   // gọi newModel() trong src/lib/actions.ts
  highlight(cells: Vec3[]): void;                   // gán app.highlight
  snapshot(frame: boolean): string | null;          // base64 PNG từ viewport
  notify(tool: string): void;                       // app.flash("AI: fill_box")
}
export interface Tool { name; description; inputSchema; run(args, ctx): Promise<Content[]> }
export const TOOLS: Tool[]
```
Có hàm phụ `edit(ctx, fn)` dùng chung cho các công cụ sửa: kiểm tra `inStroke` (quy tắc 10), mở stroke, chạy `fn`, rồi đóng stroke trong `finally`.

| # | Công cụ | Tham số | Dùng lại code có sẵn |
|---|---|---|---|
| 1 | `get_model` | — | `editor.grid.dims`, `grid.count()`, `editor.palette`, `ctx.info()` |
| 2 | `get_layer` | `z` | `grid.get`. Trả về mỗi hàng một chuỗi, mỗi ô 2 ký tự hex (`00` = trống) |
| 3 | `set_voxels` | `voxels: [x,y,z,color][]` (≤20.000) | `grid.index` + `editor.apply` |
| 4 | `fill_box` | `from`, `to`, `color` (0 = xóa) | `boxCells` (`src/lib/core/tools.ts`) + `editor.fill` |
| 5 | `new_model` | `sx, sy, sz` (1–128) | `newModel` (`src/lib/actions.ts`). Có thay đổi chưa lưu thì từ chối |
| 6 | `set_color` | `hex`, `index?` (bỏ trống = thêm màu mới) | `editor.setColor` / `editor.addColor` |
| 7 | `print_check` | — | `analyze` (`src/lib/core/analysis.ts`), tô sáng vùng lỗi |
| 8 | `fix_thin_contacts` | — | `fixThinContacts` + `editor.apply`, gói trong một bước hoàn tác |
| 9 | `undo` | — | `editor.undo()` |
| 10 | `snapshot` | `frame?` | `ctx.snapshot` → nội dung dạng `{type:'image', mimeType:'image/png'}` |

### 5. `src/lib/mcp/bridge.ts` (mới)

- `startMcp(port, token)`: gọi `invoke('mcp_start')`, rồi `listen('mcp-request', …)`. Mỗi sự kiện chạy `handleMessage` rồi `invoke('mcp_respond', {id, body: out ?? ''})`.
- `stopMcp()`: hủy nghe sự kiện, gọi `invoke('mcp_stop')`, đặt `app.mcpOn = false`.
- Cài đặt lưu trong `localStorage['pictus.mcp'] = {enabled, port, token}`, bọc trong try/catch giống `addRecent` ở `src/lib/state/app.svelte.ts`. Cổng mặc định 47821.
- `registerViewport(v)` / biến `ctx`: nối `ToolCtx` với `app`, `editor` và viewport thật.

### 6. `src/lib/render/viewport.ts` (sửa)

```ts
/** PNG base64 của khung nhìn hiện tại, cạnh dài tối đa 768 px để tiết kiệm token. */
snapshot(frame = false): string {
  if (frame) this.frame();
  if (this.dirtyChunks.size) this.flushChunks();
  this.renderer.render(this.scene, this.camera);   // vẽ rồi đọc ngay → không cần preserveDrawingBuffer
  // vẽ lại sang canvas nhỏ hơn → toDataURL('image/png') → bỏ tiền tố "data:"
}
```
Trong `ViewportView.svelte`, ngay sau `view = new Viewport(el)` thêm `registerViewport(view)`.

### 7. Giao diện

- **`AiDialog.svelte`**, dùng lại `Modal.svelte` sẵn có, gồm:
  - Công tắc Bật/Tắt, ô Cổng, Token (ẩn bớt ký tự, có nút "New token").
  - Ô lệnh kèm nút Copy: `claude mcp add --transport http pictus http://127.0.0.1:47821/mcp --header "Authorization: Bearer <token>"`.
  - Một dòng cảnh báo: "Any program that has this token can edit the open model."
- **`MenuBar.svelte`**: nút "AI…" đặt cạnh nút Print check, gán `app.dialog = 'ai'`.
- **`StatusBar.svelte`**: khi `app.mcpOn` thì hiện chấm xanh "AI on".
- **`+page.svelte`**: thêm `{#if app.dialog === 'ai'}<AiDialog />{/if}`. Trong `onMount`, nếu cài đặt `enabled` thì gọi `startMcp`.

### 8. `tests/mcp.test.ts` (mới)

Dùng `Editor` thật cùng một `ctx` giả. Các trường hợp cần test:
- Giao thức: `initialize`, `tools/list`, thông báo trả `null`, JSON lỗi, phương thức lạ.
- `set_voxels` / `fill_box` thay đổi đúng ô và gộp thành **một** bước hoàn tác.
- Tọa độ ngoài lưới hoặc màu không tồn tại thì trả `isError`.
- Đang `inStroke` thì từ chối.
- `new_model` bị từ chối khi `dirty`.
- `fix_thin_contacts` hết chỗ chạm cạnh/góc trên mẫu thử sẵn trong `tests/helpers.ts` / `mesh.test.ts`.

Rust: unit test cho `authorize` (thiếu token, sai token, có Origin, đúng).

---

## Các mốc thực hiện (mỗi mốc một commit, bạn duyệt xong mới sang mốc sau)

| Mốc | Việc | Xong khi |
|---|---|---|
| **M0** | Chép kế hoạch này vào `Hai_doc/KE_HOACH_A2_MCP.md`, tạo nhánh `feat/mcp` | Có file và nhánh |
| **M1** | `mcp.rs` + `lib.rs` + `bridge.ts` + `protocol.ts` (mới có `initialize` / `ping`) | Gọi `curl` với token → trả `initialize`; không token → 401; có Origin → 403; `cargo test` đạt |
| **M2** | `tools.ts`: `get_model`, `get_layer`. Kết nối Claude Code | Trong Claude Code, `/mcp` thấy "pictus"; hỏi "mô hình đang có gì" thì AI trả lời đúng |
| **M3** | `set_voxels`, `fill_box`, `new_model`, `set_color`, `undo` + quy tắc 9, 10 | Nhờ AI vẽ một cây nấm, thấy hiện ngay; Ctrl+Z gỡ từng bước của AI |
| **M4** | `print_check`, `fix_thin_contacts`, `snapshot` | AI tự chụp ảnh, tự phát hiện và sửa lỗi in |
| **M5** | `AiDialog`, menu, thanh trạng thái, lưu cài đặt | Bật/tắt bằng giao diện, khởi động lại app vẫn nhớ |
| **M6** | `tests/mcp.test.ts`, cập nhật README / IMPLEMENTATION_DOC / Hai_doc | `pnpm test`, `pnpm check`, `cargo test` đều đạt |

## Kiểm tra từ đầu đến cuối

1. `pnpm tauri dev`, mở hộp thoại AI, bấm Bật, rồi Copy lệnh.
2. Thử bằng curl:
   `curl -s -X POST http://127.0.0.1:47821/mcp -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"`
   Kết quả phải có 10 công cụ. Bỏ header token → 401. Thêm `-H "Origin: http://evil"` → 403.
3. Dán lệnh `claude mcp add …` vào terminal, mở Claude Code, gõ `/mcp` để thấy "pictus" đã kết nối.
4. Nhờ Claude Code: "tạo một cây nấm đỏ trắng cao 12 khối, chụp lại xem rồi kiểm tra in". Theo dõi khung 3D, sau đó Ctrl+Z vài lần.
5. Thử vẽ tay đúng lúc AI đang gửi lệnh: lệnh của AI phải bị từ chối nhẹ nhàng, không làm hỏng nét vẽ.
6. Tắt AI trong hộp thoại, gọi curl lại: không kết nối được.

---

## Đã làm gọn những gì

| Chỗ làm gọn | Thay vì | Tiết kiệm |
|---|---|---|
| Rust chỉ trung chuyển, giao thức viết bằng TS | Thư viện MCP cho Rust (`rmcp`) + axum/hyper | Ít thư viện, bộ cài nhẹ hơn, logic test được bằng vitest |
| `tiny_http` (nhỏ, không cần async) | axum + hyper | Khoảng 30 thư viện phụ |
| Token tạo ở giao diện | Thêm thư viện sinh số ngẫu nhiên cho Rust | 1 thư viện |
| Không có SSE, không có session, xử lý lần lượt | Luồng SSE, `Mcp-Session-Id`, chạy song song | Rất nhiều code xử lý trạng thái |
| Không có công cụ file ở bản đầu | Lưu, mở, xuất qua AI | Bớt rủi ro bảo mật, bớt code |
| 10 công cụ | Mỗi công cụ vẽ của app một lệnh MCP (đối xứng, tô loang, đường thẳng…) | AI tự tính toán được, không cần |

**Có thể cắt thêm nếu muốn gọn nữa** (ít khoảng 150 dòng, đổi lại kém tiện hơn):
- Bỏ `AiDialog`: cố định cổng, chỉ hiện token trên thanh trạng thái và có một nút bật/tắt trong menu.
- Bỏ `snapshot`: không phải sửa `viewport.ts`, nhưng AI không tự nhìn được kết quả.
- Bỏ `new_model` / `set_color`: AI chỉ vẽ được trên lưới và bảng màu sẵn có.

**Không nên cắt:** kiểm tra token và Origin, chỉ nghe localhost, mặc định tắt, mỗi lệnh một bước hoàn tác, quy tắc không chen vào lúc người dùng đang vẽ.

## Rủi ro và việc cần xác minh lúc code

- **Phiên bản giao thức MCP:** đối chiếu với đặc tả hiện hành ở mốc M1.
- **Mục tiêu chính là Claude Code** (hỗ trợ HTTP trực tiếp). Claude Desktop có thể cần một cầu nối như `mcp-remote`, sẽ thử ở mốc M6 và ghi lại kết quả.
- **Cửa sổ thu nhỏ:** WebView có thể chạy chậm lại hoặc không vẽ, nên `snapshot` có thể trả về ảnh trống. Khi đó báo lỗi rõ ràng cho AI.
- **Sửa bảng màu khi mô hình 128³** sẽ dựng lại toàn bộ (hạn chế đã biết), `set_color` có thể chậm khoảng 0,2 giây mỗi lần.
- **Sửa bảng màu không hoàn tác được** (hạn chế sẵn có của `Editor`). Ghi rõ điều này trong mô tả công cụ `set_color`.
