# Triển khai Cenar Store Bot trên VibeHost

## Hạ tầng đang sử dụng

- Nhà cung cấp bot: **VibeHost**.
- Server: `Bot Cream Store` (`163b8276`).
- Địa chỉ ứng dụng: `hcm3.vibehost.vn:20022`.
- SFTP: `hcm3.vibehost.vn:2022`.
- Thư mục chạy ứng dụng: `/home/container`.
- Database Store 1: `/home/container/data/shopbot.sqlite`.
- Database Store 2: `/home/container/data/shopbot-store2.sqlite`.
- DNS đích được panel cung cấp khi gắn domain: `160.191.87.224`.

VibeHost quản lý tiến trình bằng trang **Startup/Console**. Không cài PM2, systemd, nginx, không dùng tài
khoản root và không dùng đường dẫn `/opt`.

## 1. Chuẩn bị an toàn

1. Đổi lại mật khẩu SFTP nếu mật khẩu từng xuất hiện trong ảnh chụp hoặc tin nhắn.
2. Tải về và kiểm tra được hai file SQLite trước khi thay source.
3. Không upload đè `.env`, `.env.store2` hoặc thư mục `data/` khi chỉ cập nhật mã nguồn.
4. Giữ duy nhất một tiến trình launcher để tránh hai bot cùng đăng nhập Discord và ghi SQLite.

## 2. Cấu trúc trên hosting

```text
/home/container/
├── src/
├── scripts/
├── data/
│   ├── shopbot.sqlite
│   └── shopbot-store2.sqlite
├── .env
├── .env.store2
├── package.json
└── package-lock.json
```

Không upload `node_modules`, `.git`, `logs`, `.npm`, `.cache` hoặc bản backup cũ cùng source.

## 3. Biến môi trường chính

Store 1 dùng `/home/container/.env`; Store 2 dùng `/home/container/.env.store2`.

```dotenv
SERVER_PORT=20022
STORE1_HTTP_PORT=5000
STORE2_HTTP_PORT=8080
PUBLIC_BASE_URL=http://hcm3.vibehost.vn:20022
DATABASE_PATH=./data/shopbot.sqlite
```

Trong `.env.store2`, đặt `DATABASE_PATH=./data/shopbot-store2.sqlite` và token/client/guild riêng của Store 2.
Ba cổng phải khác nhau. Chỉ cổng `20022` được VibeHost cấp public.

Địa chỉ HTTP trên chỉ dùng tạm để kiểm tra. Trước khi vận hành webhook thanh toán production, gắn domain HTTPS
và đổi `PUBLIC_BASE_URL` sang domain đó.

## 4. Cài đặt và chạy lần đầu

Upload source vào `/home/container`, mở Console của VibeHost rồi chạy:

```bash
cd /home/container
npm ci --omit=dev --no-audit --no-fund
ENV_FILE=.env npm run check:env
ENV_FILE=.env.store2 npm run check:env
```

Trong trang Startup, dùng lệnh khởi động:

```bash
npm run start:vibehost
```

Supervisor sẽ chạy launcher, kiểm tra nhánh `bot-production` mỗi 60 giây và tự restart khi GitHub Actions đã
promote một commit mới. Launcher phải tải cả Store 1 và Store 2; không tạo hai Startup process độc lập.

## 5. Kiểm tra sau khi chạy

```bash
curl --fail http://127.0.0.1:20022/api/health
curl --fail http://127.0.0.1:20022/store2/api/health
```

Kiểm tra thêm:

- Cả hai bot online trong Discord.
- Slash commands tải đủ cho đúng guild.
- Website gọi API bằng `BOT_API_KEY` mới và không dùng IP/provider cũ.
- File SQLite vẫn nằm trong `/home/container/data` và có thời gian cập nhật hợp lý.

## 6. Đồng bộ source tự động

Mỗi push/merge vào `main` chạy workflow `Bot Production - Verify and Promote`:

1. Cài dependency từ lockfile.
2. Kiểm tra cú pháp supervisor.
3. Chạy unit test và smoke test.
4. Chỉ khi tất cả thành công mới cập nhật nhánh `bot-production` tới đúng SHA đã kiểm thử.
5. Supervisor trên VibeHost phát hiện SHA mới, backup hai SQLite, dừng bot, reset source, chạy `npm ci`, kiểm tra
   cả hai file môi trường rồi start lại.

Không cần lưu mật khẩu SFTP trong GitHub Actions. Nếu revision mới cài đặt thất bại, supervisor rollback source
về revision trước và không thử lại SHA lỗi cho đến khi có revision mới hơn.

## 7. Cập nhật source thủ công an toàn

1. GitHub Actions phải xanh cho commit cần triển khai.
2. Backup và kiểm tra integrity hai database.
3. Dừng server từ panel.
4. Upload source mới bằng SFTP, loại trừ `.env*` và `data/`.
5. Chạy `npm ci --omit=dev --no-audit --no-fund` trong Console.
6. Start/Restart từ panel, kiểm tra Console và hai health endpoint.

Nếu bản mới lỗi, dừng server, upload lại source của commit tốt gần nhất, chạy lại `npm ci` rồi Restart. Không
khôi phục SQLite chỉ vì rollback code.

## 8. Bootstrap Git lần đầu

Nếu `/home/container` chưa phải Git clone, dừng server và chạy trong Console:

```bash
cd /home/container
git init
git remote add origin https://github.com/nhan9800/Cream-Store-Bot.git
git fetch origin bot-production
git reset --hard origin/bot-production
npm ci --omit=dev --no-audit --no-fund
```

Các file `.env`, `.env.store2` và thư mục `data/` không thuộc Git nên được giữ nguyên. Sau đó đặt Startup Command
thành `npm run start:vibehost` và bấm Start.
