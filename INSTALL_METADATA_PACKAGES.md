# 📦 Cài đặt Packages cho Metadata Extraction

## ⚠️ Lưu ý

Do lỗi EPERM với bcrypt đang chạy, cần dừng tất cả services trước khi cài đặt.

## 🛑 Bước 1: Dừng tất cả services

```powershell
# Dừng tất cả Docker containers (nếu đang dùng)
docker-compose down

# Hoặc kill tất cả Node processes
taskkill /F /IM node.exe
```

## 📥 Bước 2: Cài đặt packages

```bash
yarn add sharp probe-image-size music-metadata
```

## 📦 Chi tiết packages:

### 1. **sharp** (Recommended cho images)

- Fast, high-performance image processing
- Extract dimensions (width, height)
- Extract format metadata
- Usage: Images (JPEG, PNG, WebP, TIFF, etc.)

### 2. **probe-image-size** (Fallback cho images)

- Lightweight alternative
- Works without native dependencies
- Usage: Backup nếu sharp fail

### 3. **music-metadata**

- Extract metadata từ audio/video files
- Get duration, bitrate, sample rate
- Support nhiều formats: MP3, MP4, WebM, etc.

## 🚀 Bước 3: Restart services

```bash
yarn start:dev
```

## ✅ Kết quả

Sau khi cài đặt, upload file sẽ tự động extract và trả về metadata:

### **Image Upload Response:**

```json
{
  "statusCode": 200,
  "message": "Tải file thành công",
  "metadata": {
    "_id": "67abc123...",
    "url": "https://...",
    "kind": "image",
    "width": 1920, // ⬅️ NEW!
    "height": 1080, // ⬅️ NEW!
    "size": 245678,
    "mimeType": "image/jpeg",
    "status": "uploaded"
  }
}
```

### **Video Upload Response:**

```json
{
  "statusCode": 200,
  "message": "Tải file thành công",
  "metadata": {
    "_id": "67abc123...",
    "url": "https://...",
    "kind": "video",
    "width": 1280, // ⬅️ NEW!
    "height": 720, // ⬅️ NEW!
    "duration": 125.5, // ⬅️ NEW! (seconds)
    "size": 5243876,
    "mimeType": "video/mp4",
    "status": "uploaded"
  }
}
```

### **Audio Upload Response:**

```json
{
  "statusCode": 200,
  "message": "Tải file thành công",
  "metadata": {
    "_id": "67abc123...",
    "url": "https://...",
    "kind": "audio",
    "duration": 180.25, // ⬅️ NEW! (seconds)
    "size": 3421567,
    "mimeType": "audio/mp3",
    "status": "uploaded"
  }
}
```

## 🔍 Debugging

Xem console logs để track metadata extraction:

```
🔍 Extracting metadata...
📐 Image metadata extracted: { width: 1920, height: 1080, format: 'jpeg' }
✅ Attachment record created: 67abc123...
☁️ S3 upload attempt 1/3...
✅ S3 upload successful on attempt 1
```

## ⚡ Performance Note

Metadata extraction chạy **trước khi upload S3**, không ảnh hưởng đến thời gian upload vì:

- Sharp rất nhanh (C++ binding)
- Chỉ đọc buffer, không write file
- Parse metadata < 100ms cho hầu hết files

## 🐛 Troubleshooting

### Nếu packages không cài được:

```bash
# Xóa node_modules và reinstall
rm -rf node_modules
yarn install
yarn add sharp probe-image-size music-metadata
```

### Nếu sharp fails (Windows):

Sharp cần Visual C++ build tools. Nếu fail, code sẽ tự động fallback sang probe-image-size.

### Nếu music-metadata fails:

Metadata extraction sẽ log warning nhưng upload vẫn thành công, chỉ không có duration/width/height.
