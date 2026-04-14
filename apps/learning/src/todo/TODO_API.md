# Todo API – Tài liệu cho Frontend

> **Base URL:** `http://localhost:3000` (thay bằng biến môi trường thực tế)  
> **Prefix chung:** `/todos`  
> **Auth:** Bearer token (nếu có) qua header `Authorization: Bearer <token>`

---

## Mục lục

1. [Tạo todo mới – CreateTodo](#1-tạo-todo-mới)
2. [Lấy chi tiết todo – GetTodo](#2-lấy-chi-tiết-todo)
3. [Danh sách todos – ListTodos](#3-danh-sách-todos)
4. [Cập nhật todo – UpdateTodo](#4-cập-nhật-todo)
5. [Xóa todo – DeleteTodo](#5-xóa-todo)
6. [Assign người dùng – AssignTodo](#6-assign-người-dùng)
7. [Cập nhật trạng thái – UpdateTodoStatus](#7-cập-nhật-trạng-thái)
8. [Kiểu dữ liệu chung](#8-kiểu-dữ-liệu-chung)

---

## 1. Tạo todo mới

| | |
|---|---|
| **gRPC Method** | `TodoService.CreateTodo` |
| **HTTP** | `POST /todos` |
| **Content-Type** | `application/json` |

### Request Body

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `todo_title` | `string` | ✅ | Tiêu đề todo |
| `todo_createdBy` | `string` (ObjectId) | ✅ | ID người tạo |
| `todo_description` | `string` | ❌ | Mô tả |
| `todo_status` | `TodoStatus` | ❌ | Mặc định: `"todo"` |
| `todo_priority` | `TodoPriority` | ❌ | Mặc định: `"medium"` |
| `todo_dueDate` | `string` (ISO 8601) | ❌ | Ngày hết hạn |
| `todo_roomId` | `string` (ObjectId) | ❌ | ID phòng (nếu là todo phòng) |
| `todo_assignees` | `string[]` (ObjectId[]) | ❌ | Danh sách người được assign |

### Ví dụ Request

```json
{
  "todo_title": "Hoàn thành tài liệu API",
  "todo_createdBy": "664f1a2b3c4d5e6f7a8b9c0d",
  "todo_description": "Viết tài liệu cho module Todo",
  "todo_priority": "high",
  "todo_dueDate": "2026-05-01T00:00:00.000Z",
  "todo_assignees": ["664f1a2b3c4d5e6f7a8b9c0e"]
}
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "todo_id": "abc123",
    "todo_title": "Hoàn thành tài liệu API",
    "todo_description": "Viết tài liệu cho module Todo",
    "todo_status": "todo",
    "todo_priority": "high",
    "todo_dueDate": "2026-05-01T00:00:00.000Z",
    "todo_roomId": "",
    "todo_createdBy": "664f1a2b3c4d5e6f7a8b9c0d",
    "todo_assignees": ["664f1a2b3c4d5e6f7a8b9c0e"],
    "createdAt": "2026-04-14T08:00:00.000Z",
    "updatedAt": "2026-04-14T08:00:00.000Z"
  }
}
```

---

## 2. Lấy chi tiết todo

| | |
|---|---|
| **gRPC Method** | `TodoService.GetTodo` |
| **HTTP** | `GET /todos/:todo_id` |

### Path Params

| Param | Type | Mô tả |
|---|---|---|
| `todo_id` | `string` | ID của todo |

### Ví dụ Request

```
GET /todos/abc123
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": { ...TodoItem }
}
```

### Response khi không tìm thấy

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Todo not found"
}
```

---

## 3. Danh sách todos

| | |
|---|---|
| **gRPC Method** | `TodoService.ListTodos` |
| **HTTP** | `GET /todos` |

### Query Params

| Param | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `userId` | `string` | ✅ | ID người dùng hiện tại |
| `page` | `number` (≥ 1) | ✅ | Số trang |
| `limit` | `number` (≥ 1) | ✅ | Số item/trang |
| `roomId` | `string` | ❌ | Nếu có → lấy todo của phòng; không có → lấy todo cá nhân |
| `status` | `TodoStatus` | ❌ | Filter theo trạng thái |

> **Logic lọc:**
> - Có `roomId` → lấy tất cả todo thuộc phòng đó
> - Không có `roomId` → lấy todo cá nhân: do user tạo **hoặc** được assign, và không thuộc phòng nào

### Ví dụ Request

```
GET /todos?userId=664f1a2b3c4d5e6f7a8b9c0d&page=1&limit=10&status=in_progress
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "data": [ ...TodoItem[] ],
    "total_item": 42,
    "total_page": 5,
    "page": 1
  }
}
```

---

## 4. Cập nhật todo

| | |
|---|---|
| **gRPC Method** | `TodoService.UpdateTodo` |
| **HTTP** | `PUT /todos/:todo_id` |
| **Content-Type** | `application/json` |

### Path Params

| Param | Type | Mô tả |
|---|---|---|
| `todo_id` | `string` | ID của todo |

### Request Body (tất cả optional)

| Field | Type | Mô tả |
|---|---|---|
| `todo_title` | `string` | Tiêu đề mới |
| `todo_description` | `string` | Mô tả mới |
| `todo_status` | `TodoStatus` | Trạng thái mới |
| `todo_priority` | `TodoPriority` | Độ ưu tiên mới |
| `todo_dueDate` | `string` (ISO 8601) | Ngày hết hạn mới; truyền `""` để xóa |

### Ví dụ Request

```json
{
  "todo_title": "Tiêu đề đã sửa",
  "todo_priority": "low"
}
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": { ...TodoItem (đã cập nhật) }
}
```

---

## 5. Xóa todo

| | |
|---|---|
| **gRPC Method** | `TodoService.DeleteTodo` |
| **HTTP** | `DELETE /todos/:todo_id` |

### Path Params

| Param | Type | Mô tả |
|---|---|---|
| `todo_id` | `string` | ID của todo cần xóa |

### Ví dụ Request

```
DELETE /todos/abc123
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": "Todo deleted successfully"
}
```

---

## 6. Assign người dùng

| | |
|---|---|
| **gRPC Method** | `TodoService.AssignTodo` |
| **HTTP** | `PATCH /todos/:todo_id/assign` |
| **Content-Type** | `application/json` |

> ⚠️ **Lưu ý:** Thao tác này **ghi đè toàn bộ** danh sách assignees hiện tại, không phải thêm vào.

### Path Params

| Param | Type | Mô tả |
|---|---|---|
| `todo_id` | `string` | ID của todo |

### Request Body

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `assignee_ids` | `string[]` | ✅ | Danh sách ObjectId người được assign |

### Ví dụ Request

```json
{
  "assignee_ids": [
    "664f1a2b3c4d5e6f7a8b9c0e",
    "664f1a2b3c4d5e6f7a8b9c0f"
  ]
}
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": { ...TodoItem (đã cập nhật assignees) }
}
```

---

## 7. Cập nhật trạng thái

| | |
|---|---|
| **gRPC Method** | `TodoService.UpdateTodoStatus` |
| **HTTP** | `PATCH /todos/:todo_id/status` |
| **Content-Type** | `application/json` |

### Path Params

| Param | Type | Mô tả |
|---|---|---|
| `todo_id` | `string` | ID của todo |

### Request Body

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `status` | `TodoStatus` | ✅ | Trạng thái mới |

### Ví dụ Request

```json
{
  "status": "done"
}
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": { ...TodoItem (status đã cập nhật) }
}
```

---

## 8. Kiểu dữ liệu chung

### TodoStatus

```
'todo' | 'in_progress' | 'done' | 'cancelled'
```

### TodoPriority

```
'low' | 'medium' | 'high'
```

### TodoItem

```ts
{
  todo_id: string;
  todo_title: string;
  todo_description: string;       // "" nếu không có
  todo_status: TodoStatus;
  todo_priority: TodoPriority;
  todo_dueDate: string;           // ISO 8601 | "" nếu không có
  todo_roomId: string;            // "" nếu không thuộc phòng
  todo_createdBy: string;         // ObjectId string
  todo_assignees: string[];       // ObjectId string[]
  createdAt: string;              // ISO 8601
  updatedAt: string;              // ISO 8601
}
```

### Response thất bại (chung)

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Mô tả lỗi"
}
```

| statusCode | Ý nghĩa |
|---|---|
| `400` | Bad Request – dữ liệu không hợp lệ |
| `404` | Not Found – không tìm thấy todo |
