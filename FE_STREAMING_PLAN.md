# Kế hoạch tích hợp AI Streaming (SSE) cho Frontend

Tuyệt vời! API Streaming đã hoạt động và nhả dữ liệu `chunk` liên tục như bạn thấy trên Terminal. Bây giờ là lúc hướng dẫn team Frontend xử lý luồng dữ liệu đứt đoạn (Partial JSON) này để tạo ra trải nghiệm mượt mà cho người dùng.

## Kiến trúc xử lý luồng (Stream) trên Frontend

Bởi vì AI sinh ra cấu trúc JSON (như mảng `flashcards`), Frontend sẽ không nhận được một chuỗi JSON hoàn chỉnh ngay từ đầu. Dữ liệu sẽ về dưới dạng cắt khúc:
`{"deck_name": "Lịch...` -> `sử", "flashca...` -> `rds": [{...`

**Quy trình xử lý chuẩn:**
1. **Dùng Fetch API**: Đọc luồng dữ liệu bằng `response.body.getReader()`.
2. **Nối chuỗi (Concat)**: Cộng dồn các `chunk` vào một biến `buffer` duy nhất.
3. **Hiển thị trực tiếp (Real-time)**: 
   - Có thể chỉ bóc tách các text thuần tuý để hiển thị (chỉ dùng cho chat).
   - Với JSON (Flashcard/Quiz), dùng một thư viện **Partial JSON Parser** để cố gắng ép kiểu chuỗi đứt gãy thành Object ngay cả khi AI chưa gõ xong ngoặc đóng `}`.
4. **Hoàn thành**: Khi AI gõ xong, dùng `JSON.parse` một lần cuối cùng.

---

## Proposed Changes (Triển khai code mẫu FE)

### 1. Hàm gọi API và đọc Stream
```typescript
async function fetchFlashcardsStream() {
  let partialJsonString = "";
  
  try {
    const response = await fetch("http://localhost:80/api/ai/stream/generate-flashcard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "Lịch sử Việt Nam", type: "text" })
    });

    if (!response.body) throw new Error("ReadableStream not supported");
    
    // Khởi tạo TextDecoder để dịch dữ liệu nhị phân thành chữ
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode mảng byte thành chuỗi
      const chunk = decoder.decode(value, { stream: true });
      
      // Xử lý chuẩn SSE: Dữ liệu về có dạng "data: {...}\n\n"
      // Phải lọc bỏ tiền tố "data: "
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '));
      
      for (const line of lines) {
        const textData = line.replace(/^data: /, '');
        
        // Cộng dồn chữ vào chuỗi JSON tổng
        partialJsonString += textData;
        
        // (Tuỳ chọn) Gọi hàm parse một phần để vẽ giao diện ngay lập tức
        updateUI(partialJsonString);
      }
    }
    
    // AI đã chạy xong, parse chuỗi JSON hoàn chỉnh
    const finalData = JSON.parse(partialJsonString);
    console.log("Hoàn thành!", finalData);

  } catch (error) {
    console.error("Lỗi stream:", error);
  }
}
```

### 2. Thư viện khuyến nghị để Parse Partial JSON
Việc xử lý `JSON.parse` với chuỗi `{"deck_name": "Lịch` sẽ gây lỗi. Do đó Frontend nên cài đặt thư viện [partial-json](https://www.npmjs.com/package/partial-json) hoặc `best-effort-json-parser`.

```javascript
import { parse } from 'partial-json';

function updateUI(partialString) {
  try {
    // Hàm này sẽ tự động điền các dấu ngoặc } ] còn thiếu ở cuối
    // để biến chuỗi đứt gãy thành Object hợp lệ
    const data = parse(partialString);
    
    // data.flashcards lúc này sẽ là một mảng lớn dần lên 
    // theo từng chữ AI sinh ra. Render mảng này ra màn hình!
    renderFlashcardComponent(data.flashcards);
  } catch (e) {
    // Bỏ qua lỗi trong lúc stream
  }
}
```

## User Review Required

> [!IMPORTANT]  
> **Quyết định cho Frontend:**
> Bạn muốn Frontend của mình:
> 1. Chỉ chờ nối chuỗi (concat) xong xuôi hết rồi mới vứt vào giao diện (chỉ giải quyết bài toán Timeout Nginx, không có hiệu ứng "gõ chữ" từng phần cho Flashcard).
> 2. Hay áp dụng thư viện **Partial JSON** để thẻ Flashcard vừa tạo vừa nhô ra màn hình như ChatGPT? 

Bạn hãy đưa file kế hoạch này cho team Frontend để họ áp dụng và chọn phương án UI phù hợp nhé!
