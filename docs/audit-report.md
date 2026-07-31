# Báo cáo hạ tầng hiện tại

Bot Discord/API đang chạy trên VibeHost, tách biệt với hosting website.

- Source bot: repository `Cream-Store-Bot`.
- Runtime root: `/home/container`.
- Public allocation: `hcm3.vibehost.vn:20022`.
- SFTP: `hcm3.vibehost.vn:2022`.
- Database: `/home/container/data/shopbot.sqlite` và `shopbot-store2.sqlite`.

Website giao tiếp với bot qua REST API server-to-server và đọc `BOT_API_URL`/`BOT_API_KEY` từ biến môi trường.
Không được hardcode địa chỉ hạ tầng vào source.

GitHub Actions của bot hiện chỉ chạy kiểm thử. Triển khai production thực hiện qua SFTP và Restart trên panel cho
đến khi API restart chính thức của VibeHost được xác minh.
