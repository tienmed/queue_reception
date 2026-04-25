# TTS System Safety Rules (Vietnamese)

Để đảm bảo hệ thống gọi số luôn hoạt động ổn định và không bị gián đoạn âm thanh, các quy tắc sau đây PHẢI được tuân thủ nghiêm ngặt trong mã nguồn:

### 1. Môi trường Python (Python Environment)
- **QUY TẮC**: Luôn sử dụng đường dẫn tuyệt đối cho trình thông dịch Python trong `app.js`.
- **Lý do**: Môi trường cài đặt thư viện TTS (`vieneu`) phụ thuộc vào một phiên bản Python cụ thể (thường là Python 3.11 trong AppData). Sử dụng lệnh `python` chung chung sẽ dẫn đến lỗi logic hoặc không tìm thấy thư viện.
- **Giá trị hiện tại**: `C:\Users\Thinkpad X280\AppData\Local\Programs\Python\Python311\python.exe`

### 2. Kiểm soát Thời gian chờ (Timeout Management)
- **QUY TẮC**: Giới hạn thời gian chờ (`timeout`) khi chạy script Python tối đa là **7-10 giây**.
- **Lý do**: Thư viện TTS có thể cố gắng tải dữ liệu từ Hugging Face Hub. Nếu mạng chậm hoặc bị chặn, việc chờ đợi quá lâu (như mặc định 30 giây) sẽ khiến người dùng cảm thấy hệ thống bị treo và dẫn đến lỗi giao diện.

### 3. Cơ chế Dự phòng (Fallback Mechanism)
- **QUY TẮC**: Luôn duy trì cơ chế dự phòng sang **Google TTS** nếu bridge Python thất bại hoặc hết thời gian chờ.
- **Lý do**: Đảm bảo người dùng luôn nghe thấy tiếng gọi số, ngay cả khi chất lượng giọng nói dự phòng thấp hơn một chút, thay vì ném ra lỗi đỏ trên màn hình.

### 4. Quản lý Tiến trình (Process Management)
- **QUY TẮC**: Khi debug hoặc restart server, cần kiểm tra và tiêu diệt (TaskKill) các tiến trình `node.exe` cũ đang chiếm giữ cổng (Port 3000).
- **Lý do**: Tránh tình trạng "tiến trình ma" chạy phiên bản mã nguồn cũ khiến các thay đổi mới không có tác dụng.

---
*Quy tắc này được thiết lập sau sự cố gián đoạn ngày 25/04/2026.*
