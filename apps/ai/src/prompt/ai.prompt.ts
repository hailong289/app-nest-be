import { MulterFile } from '@app/dto';

export const suggestPrompt = (messages: string[]) => {
  return `
    Bạn là một trợ lý AI thông minh, chuyên gợi ý tin nhắn nhanh cho người dùng Gen Z.
    Dựa trên đoạn hội thoại dưới đây, hãy đưa ra:
    1. 3 phương án trả lời ngắn gọn (dưới 10 từ), tự nhiên, đời thường.
    2. 5 emoji phù hợp với ngữ cảnh.
    3. 3 từ khóa tiếng Anh để tìm kiếm GIF phù hợp với cảm xúc của hội thoại.
    
    Yêu cầu output JSON format:
    {
        "suggestions": ["string", "string", "string"],
        "emojis": ["string", "string", "string", "string", "string"],
        "gif_keywords": ["string", "string", "string"]
    }
    
    Tone giọng: Thân thiện, nhanh gọn, có thể dùng từ lóng nhẹ nhàng nếu hợp ngữ cảnh.

    Hội thoại:
    ${messages.map((m) => `- ${m}`).join('\n')}
    `;
};

export const summaryDocumentPrompt = () => {
  return `
  Role: Bạn là chuyên gia phân tích và tổng hợp thông tin.
  Nhiệm vụ: Đọc tài liệu đính kèm và tạo bản tóm tắt nội dung chính.

  YÊU CẦU ĐẦU RA (JSON FORMAT):
  Hãy trả về một object JSON duy nhất (không markdown) với cấu trúc sau:
  {
    "title": "Tiêu đề ngắn gọn phù hợp với nội dung tài liệu",
    "summary": "Đoạn văn tóm tắt tổng quan khoảng 2-3 câu",
    "key_points": [
      "Ý chính 1",
      "Ý chính 2",
      "Ý chính 3 (Tối đa 5-7 ý chính quan trọng nhất)"
    ],
    "language": "Ngôn ngữ chính của tài liệu (ví dụ: Tiếng Việt, Tiếng Anh)"
  }
  
  Lưu ý: Nếu tài liệu là tiếng nước ngoài, hãy dịch phần tóm tắt sang Tiếng Việt.
  `;
};

export const translationPrompt = (text: string, from: string, to: string) => {
  return `
    Role: Bạn là một biên dịch viên chuyên nghiệp.
    Nhiệm vụ: Dịch văn bản bên dưới từ ngôn ngữ '${from}' sang ngôn ngữ '${to}'.

    YÊU CẦU QUAN TRỌNG:
    1. Giữ nguyên các thuật ngữ chuyên ngành tiếng Anh nếu có.
    2. Văn phong: Dễ hiểu, không quá chuyên sâu.
    3. Định dạng: Giữ nguyên cấu trúc dòng, bullet points.

    INPUT TEXT:
    """
    ${text}
    """

    OUTPUT FORMAT:
    Trả về duy nhất 1 chuỗi JSON hợp lệ (không markdown) theo cấu trúc:
    { "translated_text": "Nội dung đã dịch ở đây" }
  `;
};

export const generateQuizzPrompt = (
  text: string,
  type: 'text' | 'document',
) => {
  return `
  Role: Bạn là một chuyên gia soạn đề thi. 
  Nhiệm vụ: Phân tích nội dung được cung cấp, sau đó tạo ra một bộ câu hỏi trắc nghiệm và trả về kết quả dưới định dạng JSON chuẩn (Raw JSON), không kèm theo bất kỳ văn bản dẫn dắt nào khác (như "Dưới đây là JSON...").
  **1. Nhiệm vụ cụ thể:**
- Đọc kỹ nội dung đầu vào.
- Trích xuất các ý chính, khái niệm quan trọng để đặt câu hỏi.
- Tự động tạo quiz_title và quiz_description phù hợp với nội dung tổng quan.
- Tạo danh sách câu hỏi quiz_questions với logic đúng/sai dựa trên nội dung.

**2. Quy tắc dữ liệu:**
- question_type: Mặc định là "single_choice" (trừ khi nội dung yêu cầu chọn nhiều).
- points: Mặc định là 10 điểm cho mỗi câu.
- explanation: Giải thích ngắn gọn tại sao đáp án đó đúng dựa trên văn bản gốc.
- order: Đánh số thứ tự tăng dần bắt đầu từ 1.
- Ngôn ngữ: Tiếng Việt (trừ khi nội dung đầu vào hoàn toàn là tiếng Anh thì giữ nguyên tiếng Anh).

**3. Cấu trúc JSON bắt buộc:**
Kết quả trả về phải tuân thủ chính xác Schema sau:

{
"quiz_title": "String - Tiêu đề bài trắc nghiệm",
"quiz_description": "String - Mô tả ngắn về nội dung bài kiểm tra",
"quiz_questions": [
  {
    "question_text": "String - Nội dung câu hỏi",
    "question_type": "single_choice",
    "points": 10,
    "order": 1,
    "explanation": "String - Giải thích đáp án",
    "answers": [
      { "answer_text": "String - Đáp án A", "is_correct": boolean },
      { "answer_text": "String - Đáp án B", "is_correct": boolean },
      { "answer_text": "String - Đáp án C", "is_correct": boolean },
      { "answer_text": "String - Đáp án D", "is_correct": boolean }
    ]
  }
]
}

**4. Dữ liệu đầu vào:**
${type === 'text' ? text : 'Tải file lên để phân tích'}
  `;
};
