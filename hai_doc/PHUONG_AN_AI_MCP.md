# Phương án đưa AI / MCP vào Pictus

_Ngày viết: 24/11/2026 — chưa chọn phương án, chưa viết code._

Lợi thế của Pictus: toàn bộ phần lõi [src/lib/core/](../src/lib/core/) là TypeScript thuần, không dính giao diện. Một MCP server có thể dùng lại ngay phần đọc/ghi file, tô loang, kiểm tra in và xuất STL/3MF mà không phải viết lại.

Có 3 hướng.

## Hướng A — Pictus làm MCP server (AI bên ngoài như Claude Desktop, Claude Code điều khiển Pictus)

| | Cách làm | Ưu điểm | Nhược điểm |
|---|---|---|---|
| **A1. Server độc lập, làm việc trên file** | Một chương trình Node/TS nhỏ chạy qua stdio, dùng lại `core/`. AI tạo, sửa, kiểm tra và xuất các file `.pictus` / `.vox` / `.3mf`. | Làm nhanh nhất, không cần mở app, không làm nặng bộ cài, kiểm thử bằng vitest như hiện tại. | Không thấy mô hình thay đổi ngay trên màn hình, phải mở lại file trong Pictus. |
| **A2. Server nhúng trong app** | Rust trong Tauri mở cổng MCP qua HTTP ở `127.0.0.1`, chuyển lệnh sang `Editor` ở giao diện. | AI vẽ đến đâu thấy đến đó, Ctrl+Z hoàn tác được thao tác của AI. | Phải viết thêm Rust và cầu nối, chỉ chạy khi app đang mở, phải bảo vệ cổng (chỉ localhost, có token). |
| **A3. Kết hợp A1 và A2** | Server stdio như A1. Nếu Pictus đang mở thì gửi lệnh vào app qua WebSocket localhost, nếu không thì làm trên file. | Linh hoạt nhất. | Phức tạp nhất. |

## Hướng B — AI nằm ngay trong Pictus (khung chat trong app)

| | Cách làm | Ưu điểm | Nhược điểm |
|---|---|---|---|
| **B1. Chat gọi Claude API kèm công cụ (tool use)** | Thêm một ô chat, người dùng gõ ví dụ "làm con mèo 3 màu cao 20 mm", Claude gọi các công cụ của Pictus. | Người dùng cuối không cần cài Claude Desktop. | Cần API key và mạng, tốn phí theo lượt dùng. Key phải lưu ở phía Rust hoặc kho khóa của Windows, không để lộ trong giao diện web. App nặng hơn, đi ngược mục tiêu "tối giản". |
| **B2. Pictus làm MCP client** | App kết nối tới các MCP server khác, ví dụ dịch vụ tạo ảnh. | Mở rộng được về sau. | Ít giá trị cho một trình vẽ voxel, nên để sau. |

## Hướng C — Không dùng MCP

Viết một công cụ dòng lệnh `pictus-cli` (ví dụ `pictus-cli export model.pictus --3mf`) để AI gọi bằng script. Cách này đơn giản nhưng AI dùng kém tiện và kém chính xác hơn MCP.

## Các công cụ (tool) nên có, áp dụng cho mọi phương án

- **Xem mô hình:** `get_model_info` (kích thước, màu, số khối), `get_layer` (đọc một lớp Z).
- **Sửa mô hình:** `new_model`, `set_voxels`, `fill_box`, `erase_box`, `flood_fill`, `set_palette_color`.
- **Nhập từ ảnh:** `import_image` (PNG thành móc khóa).
- **Kiểm tra in:** `print_check`, `fix_thin_contacts`.
- **Lưu và xuất:** `save`, `export_3mf` / `export_stl` / `export_obj`.
- **Chụp ảnh:** `render_snapshot` để AI tự nhìn kết quả. Chỉ làm được với A2/A3 vì cần khung 3D.

Mỗi lệnh sửa nên gom thành **một bước hoàn tác**, việc này `Editor` đã hỗ trợ sẵn bằng `beginStroke` / `endStroke`.

## Đề xuất

1. **Làm A1 trước.** Ít việc nhất, tận dụng được `core/`, không ảnh hưởng app hiện tại, dùng được ngay với Claude Code hoặc Claude Desktop.
2. **Nâng lên A3** khi muốn thấy AI vẽ trực tiếp trên màn hình.
3. **Chỉ làm B1** nếu muốn phát hành cho người dùng phổ thông không có Claude Desktop.

Bước tiếp theo: chọn phương án, sau đó lên kế hoạch chi tiết (thư mục, danh sách công cụ, cách cấu hình vào Claude) trước khi viết code.
