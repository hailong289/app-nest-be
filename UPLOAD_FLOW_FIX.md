# 🔧 Fix Upload Flow - Xử lý Temporary ID

## 🐛 **Vấn đề gốc:**

Client gửi temporary ID (ví dụ: `"temp_1762520954460_0.2623998847813628"`) khi upload file, nhưng server cố gắng dùng nó như MongoDB ObjectId → **CastError**.

## ✅ **Giải pháp:**

### **1. Validate ID Format**

```typescript
// Regex kiểm tra MongoDB ObjectId hợp lệ (24 ký tự hex)
const isValidObjectId = id && /^[0-9a-fA-F]{24}$/.test(id);
```

### **2. Flow xử lý:**

#### **Case A: Không có ID hoặc ID không hợp lệ (temp ID)**

```typescript
if (!id || !isValidObjectId) {
  // Tạo mới attachment với MongoDB auto-generated _id
  const created = await this.attachmentModel.create(attachmentData);

  console.log('✅ New attachment created:', created._id);
  // Return: 67abc123... (valid MongoDB ObjectId)
}
```

**Client flow:**

1. Tạo temp ID: `temp_${timestamp}_${random}`
2. Gửi upload request với temp ID
3. Server bỏ qua temp ID, tạo mới với real ObjectId
4. Client nhận real ObjectId từ response
5. Client replace temp ID bằng real ObjectId trong UI

#### **Case B: ID hợp lệ (retry sau khi fail)**

```typescript
if (id && isValidObjectId) {
  // Cố gắng update attachment đã tồn tại
  const updated = await this.attachmentModel.findOneAndUpdate(
    { _id: id },
    attachmentData,
    { new: true },
  );

  if (updated) {
    console.log('🔄 Attachment updated:', updated._id);
    // Retry upload thành công
  } else {
    console.log('⚠️ ID not found, creating new');
    // ID không tồn tại, tạo mới
    const created = await this.attachmentModel.create(attachmentData);
  }
}
```

**Retry flow:**

1. Upload fail lần 1 → attachment đã tạo trong DB (status: 'failed')
2. Client retry với real ObjectId từ response lần 1
3. Server update attachment đã tồn tại
4. Upload thành công → status: 'uploaded'

## 📊 **Upload Flow Chart:**

```
Client                          Server                      MongoDB
  |                               |                            |
  |-- POST /upload -------------->|                            |
  |   { id: "temp_123", file }    |                            |
  |                               |                            |
  |                               |-- Validate ID              |
  |                               |   ❌ Not valid ObjectId    |
  |                               |                            |
  |                               |-- Create new ------------->|
  |                               |                            |-- Generate ObjectId
  |                               |<-------------------------- |   67abc123...
  |                               |                            |
  |                               |-- Upload to S3             |
  |                               |   ✅ Success               |
  |                               |                            |
  |                               |-- Update status ---------->|
  |                               |   { status: 'uploaded' }   |
  |                               |                            |
  |<-- Response ------------------|                            |
  |   { _id: "67abc123...", ... } |                            |
  |                               |                            |
  |-- Update UI                   |                            |
  |   temp_123 → 67abc123...      |                            |
```

## 🔍 **Console Logs:**

### **Upload với Temp ID:**

```
🔄 Upload request received with ID: temp_1762520954460_0.2623998847813628
⚠️ Invalid ID format (temp ID), creating new attachment: temp_1762520954460_0.2623998847813628
🔍 Extracting metadata...
📐 Image metadata extracted: { width: 1920, height: 1080 }
✅ Attachment record created/updated: 67abc123def456...
☁️ S3 upload attempt 1/3...
✅ S3 upload successful on attempt 1
```

### **Retry với Real ObjectId:**

```
🔄 Upload request received with ID: 67abc123def456...
🔄 Updating existing attachment: 67abc123def456...
✅ Attachment record created/updated: 67abc123def456...
☁️ S3 upload attempt 1/3...
✅ S3 upload successful on attempt 1
```

## 🎯 **Best Practices Client-Side:**

### **1. Optimistic UI Update**

```typescript
// Client tạo temp ID ngay khi user chọn file
const tempId = `temp_${Date.now()}_${Math.random()}`;

// Show file trong UI ngay lập tức
addAttachmentToUI({ id: tempId, status: 'uploading', url: localBlob });

// Upload
const response = await uploadFile({ id: tempId, file });

// Replace temp ID với real ID
updateAttachmentInUI(tempId, {
  id: response._id, // Real ObjectId
  status: 'uploaded',
  url: response.url,
});
```

### **2. Error Handling**

```typescript
try {
  const response = await uploadFile({ id: tempId, file });

  if (response.statusCode === 200) {
    // Success
    updateAttachmentInUI(tempId, { id: response.metadata._id });
  }
} catch (error) {
  // Fail - giữ temp ID để retry
  updateAttachmentStatus(tempId, 'failed');

  // Retry button
  onRetry(() => {
    // Có thể dùng temp ID hoặc không gửi ID
    uploadFile({ file }); // Server sẽ tạo mới
  });
}
```

## 🔒 **Validation Rules:**

| ID Value                             | Valid? | Action                         |
| ------------------------------------ | ------ | ------------------------------ |
| `undefined`                          | ✅     | Create new                     |
| `null`                               | ✅     | Create new                     |
| `""` (empty)                         | ✅     | Create new                     |
| `"temp_123"`                         | ❌     | Create new (ignore temp ID)    |
| `"67abc123def456..."` (24 hex chars) | ✅     | Update existing or create new  |
| `"123"` (invalid format)             | ❌     | Create new (ignore invalid ID) |

## 📝 **Summary:**

- ✅ Server tự động detect temp ID và ignore
- ✅ Không crash với CastError
- ✅ Support retry với real ObjectId
- ✅ Optimistic UI updates ở client
- ✅ Clear logging để debug

**Result:** Upload flow robust, không bị fail với temporary IDs! 🚀
