# Bot API

Bot launcher expose REST API qua allocation VibeHost `hcm3.vibehost.vn:20022`. Website phải gọi API từ server
side và gửi header `X-Bot-Api-Key`; không đưa `BOT_API_KEY` xuống trình duyệt.

## Cấu hình

Bot và website dùng cùng một giá trị bí mật:

```dotenv
BOT_API_KEY=<random-secret>
```

Sau khi đổi key, restart bot bằng panel VibeHost và redeploy website để hai bên đồng bộ.

## Health

```bash
curl http://hcm3.vibehost.vn:20022/api/health
curl http://hcm3.vibehost.vn:20022/store2/api/health
```

Địa chỉ HTTP này chỉ dùng kiểm tra ban đầu. Production nên dùng custom domain HTTPS.

## Endpoint chính

- `GET /api/bot/health`
- `GET /api/bot/stats`
- `GET /api/bot/orders`
- `GET /api/bot/orders/:code`
- `GET /api/bot/customer/:discord_id`
- `GET /api/bot/feedbacks`
- `GET /api/bot/products`
- `GET /api/bot/top-customers?limit=10`
- `GET /api/bot/top-products?limit=10`

Các endpoint nội bộ phải trả `401` khi thiếu hoặc sai API key. Endpoint public chỉ được trả dữ liệu đã ẩn thông
tin nhạy cảm.

## Quy tắc mạng và secret

- Không hardcode host cũ hoặc địa chỉ IP trực tiếp trong source website.
- Website đọc URL từ `BOT_API_URL` và key từ secret của hosting website.
- Không commit `.env`, token Discord, khóa PayOS hoặc SFTP credential.
- Khi rotate `BOT_API_KEY`, cập nhật bot và website trong cùng một cửa sổ bảo trì.
