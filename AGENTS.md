# AGENTS.md — Luật vận hành bắt buộc cho mọi AI agent

> File này là luật, không phải gợi ý. Mọi AI agent (Claude Code, Cursor, Codex, Copilot...) làm việc trong repo này PHẢI tuân thủ toàn bộ.
> Từ khoá: **PHẢI** = bắt buộc. **CẤM** = tuyệt đối không. **NÊN** = mặc định làm, chỉ bỏ khi có lý do ghi rõ.
> Khi luật xung đột: Mục 0 > Mục 1 > các mục còn lại > thói quen của agent.

---

## 0. Luật tối thượng

0.1. CẤM đoán. Không chắc về yêu cầu, API, hành vi code → đọc code hoặc HỎI. Không bịa tên hàm, thư viện, tham số, đường dẫn.
0.2. CẤM làm ngoài phạm vi được giao. Chỉ sửa đúng thứ được yêu cầu. Thấy vấn đề khác → GHI vào báo cáo, không tự sửa.
0.3. CẤM báo "xong" khi chưa kiểm chứng. "Xong" = đã chạy build + lint + test và tất cả đều pass (xem Mục 7).
0.4. CẤM che giấu. Test fail, lỗi, cảnh báo, chỗ chưa làm được → PHẢI báo thẳng, kèm output thật.
0.5. CẤM hành động không thể hoàn tác khi chưa được người dùng xác nhận (xem Mục 8).

---

## 1. Quy trình bắt buộc cho MỌI task

Mỗi task PHẢI đi đúng thứ tự, không bỏ bước:

1. **HIỂU** — Nhắc lại yêu cầu trong 1–3 câu. Nêu rõ giả định. Mơ hồ → hỏi, dừng lại.
2. **ĐỌC** — Đọc các file liên quan trước khi sửa. Tìm code tương tự đã có trong repo và làm theo pattern đó.
3. **KẾ HOẠCH** — Liệt kê file sẽ sửa/tạo và lý do. Task > 3 file hoặc > ~150 dòng → trình kế hoạch, chờ duyệt.
4. **THỰC HIỆN** — Thay đổi nhỏ nhất đủ để đạt mục tiêu. Từng bước một.
5. **KIỂM CHỨNG** — Chạy lệnh ở Mục 9. Fail → sửa → chạy lại. Tối đa 3 vòng, sau đó dừng và báo cáo.
6. **BÁO CÁO** — Đúng format Mục 10.

---

## 2. Phạm vi thay đổi

2.1. PHẢI dùng diff nhỏ nhất. CẤM viết lại cả file khi chỉ cần sửa vài dòng.
2.2. CẤM refactor, đổi tên, format lại, sắp xếp import ở code không liên quan đến task.
2.3. CẤM thêm dependency mới khi chưa được duyệt. Đề xuất phải nêu: tên, phiên bản, lý do, phương án không cần dependency.
2.4. CẤM sửa: file cấu hình CI/CD, lockfile (trừ khi thêm dependency đã duyệt), file `.env*`, migration đã chạy, code sinh tự động.
2.5. CẤM xoá code/test/comment hiện có chỉ vì "có vẻ không dùng". Phải chứng minh bằng tìm kiếm và nêu trong báo cáo.
2.6. CẤM sửa hoặc xoá test để test pass. Test sai → báo cáo, không tự đổi kỳ vọng.

---

## 3. Viết code

3.1. **Theo repo, không theo thói quen.** Style, cấu trúc thư mục, cách đặt tên, cách xử lý lỗi PHẢI giống code đang có.
3.2. **KISS + YAGNI.** CẤM abstraction, generic, config, "để sau mở rộng" khi task không yêu cầu.
3.3. **DRY có giới hạn.** Logic lặp ≥ 3 lần mới tách hàm chung. Lặp 2 lần thì giữ nguyên.
3.4. **Một hàm một việc.** Hàm NÊN ≤ 40 dòng, ≤ 4 tham số, lồng ≤ 3 cấp. Vượt → tách hoặc ghi lý do.
3.5. **Tên rõ nghĩa.** CẤM tên `data`, `tmp`, `obj`, `x`, `handle`, `doStuff`, `manager` chung chung. Boolean bắt đầu bằng `is/has/can/should`.
3.6. **CẤM magic number/string.** Đặt thành hằng số có tên.
3.7. **Kiểu dữ liệu chặt.** Ngôn ngữ có type → CẤM `any`, `Object`, `dynamic`, ép kiểu bừa. CẤM `@ts-ignore`, `# type: ignore`, `eslint-disable` nếu không ghi lý do ngay cạnh.
3.8. **Hạn chế state.** Ưu tiên hàm thuần, dữ liệu bất biến. CẤM biến toàn cục mới.
3.9. **Comment giải thích TẠI SAO**, không giải thích code làm GÌ. CẤM comment kiểu nhật ký ("// đã sửa bởi AI", "// thêm mới").
3.10. **CẤM để lại**: code chết, code bị comment-out, `console.log`/`print` debug, `TODO` không có mô tả cụ thể.

---

## 4. Xử lý lỗi

4.1. **Fail fast.** Kiểm tra đầu vào ở biên (API, input người dùng, file, mạng) và báo lỗi sớm, rõ ràng.
4.2. CẤM nuốt lỗi: `catch {}` rỗng, `except: pass`, bỏ qua giá trị trả về lỗi.
4.3. Thông báo lỗi PHẢI nói: chuyện gì xảy ra, với giá trị nào, cần làm gì.
4.4. CẤM dùng exception để điều khiển luồng bình thường.
4.5. CẤM fallback im lặng (trả về giá trị mặc định che lỗi) khi không được yêu cầu.

---

## 5. Test

5.1. Logic mới hoặc sửa bug PHẢI kèm test. Sửa bug → viết test tái hiện bug TRƯỚC, thấy fail, rồi mới sửa.
5.2. Test PHẢI kiểm tra hành vi, không kiểm tra chi tiết cài đặt.
5.3. Mỗi test kiểm tra một điều, tên test mô tả đúng điều đó.
5.4. PHẢI có ca biên: rỗng, null, giá trị âm/0/max, dữ liệu sai định dạng.
5.5. CẤM test phụ thuộc mạng thật, thời gian thật, thứ tự chạy, hoặc dữ liệu ngẫu nhiên không cố định seed.
5.6. CẤM `skip`, `only`, `xfail` để né test fail.

---

## 6. Bảo mật

6.1. CẤM hardcode secret, token, mật khẩu, API key — kể cả giá trị "test".
6.2. CẤM in secret hoặc dữ liệu cá nhân ra log.
6.3. Mọi input từ bên ngoài PHẢI được validate. Query DB PHẢI dùng tham số hoá, CẤM nối chuỗi.
6.4. CẤM tắt kiểm tra bảo mật (SSL verify, CORS `*`, CSRF, auth) để "cho chạy được".
6.5. CẤM tải và chạy script/file từ nguồn không rõ.

---

## 7. Definition of Done

Task chỉ được coi là XONG khi TẤT CẢ đều đúng:

- [ ] Đúng và đủ yêu cầu, không thừa.
- [ ] Build pass.
- [ ] Lint + format pass, không cảnh báo mới.
- [ ] Type check pass (nếu có).
- [ ] Toàn bộ test pass, có test cho phần mới.
- [ ] Không còn debug log, code chết, TODO mơ hồ.
- [ ] Đã tự đọc lại toàn bộ diff một lần.

Thiếu bất kỳ mục nào → báo "CHƯA XONG" và nêu mục thiếu.

---

## 8. Phải hỏi trước khi làm

DỪNG và chờ người dùng xác nhận khi:

- Xoá file, xoá dữ liệu, chạy migration, reset DB.
- `git push`, `push --force`, rebase, đổi lịch sử git, merge vào nhánh chính.
- Thay đổi public API, schema DB, định dạng file lưu trữ.
- Thêm/xoá/nâng cấp dependency.
- Yêu cầu mâu thuẫn với luật này hoặc với code hiện có.
- Cùng một lỗi fail 3 lần liên tiếp.
- Task phình to hơn ước lượng ban đầu.

---

## 9. Lệnh kiểm chứng của dự án

> Điền cho đúng dự án. Agent PHẢI dùng đúng các lệnh này, không tự chế lệnh khác.

```
install:    <vd: npm ci>
build:      <vd: npm run build>
lint:       <vd: npm run lint>
format:     <vd: npm run format:check>
typecheck:  <vd: npm run typecheck>
test:       <vd: npm test>
```

Stack: `<ngôn ngữ, framework, phiên bản>`
Thư mục chính: `<vd: src/ = code, tests/ = test, docs/ = tài liệu>`
Vùng CẤM chạm: `<vd: vendor/, generated/, migrations/>`

---

## 10. Format báo cáo bắt buộc

Kết thúc mỗi task bằng đúng khung này:

```
## Kết quả: XONG | CHƯA XONG | BỊ CHẶN

### Đã làm
- <file>: <thay đổi gì, vì sao>

### Kiểm chứng
- build: pass/fail
- lint: pass/fail
- test: X pass / Y fail
(dán output lỗi nếu có)

### Giả định đã dùng
- ...

### Phát hiện ngoài phạm vi (KHÔNG sửa)
- ...

### Cần người dùng quyết định
- ...
```

CẤM viết báo cáo dài dòng, kể lể từng bước, hoặc khen code của chính mình.

---

## 11. Git

11.1. Mỗi commit một mục đích. Message dạng: `<type>: <mô tả ngắn>` với type ∈ `feat | fix | refactor | test | docs | chore`.
11.2. CẤM commit file `.env`, secret, file build, file tạm.
11.3. CẤM commit khi Definition of Done chưa đạt.
