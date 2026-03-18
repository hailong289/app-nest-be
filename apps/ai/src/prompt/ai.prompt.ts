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

export const generateFlashcardPrompt = (
  topic: string,
  type: 'text' | 'document',
  card_count: number,
  difficulty: number,
  language: string,
) => {
  return `
Role: Bạn là một chuyên gia giáo dục và thiết kế thẻ học (flashcard) thông minh.
Nhiệm vụ: Dựa vào nội dung đầu vào, tạo ra ${card_count} flashcard chất lượng cao và trả về kết quả dưới định dạng **Raw JSON**.

**1. Thông số kỹ thuật:**
- Số lượng flashcard cần tạo: ${card_count} thẻ.
- Độ khó mong muốn (card_difficulty): ${difficulty} (thang 1–5, 1 = dễ nhất, 5 = khó nhất).
- Ngôn ngữ đầu ra: ${language}.

**2. Quy tắc tạo flashcard:**
- Mỗi flashcard phải có nội dung súc tích, rõ ràng và chính xác.
- "card_front": Câu hỏi, thuật ngữ hoặc khái niệm cần ghi nhớ (≤ 1000 ký tự).
- "card_back": Câu trả lời, định nghĩa hoặc giải thích chi tiết (≤ 2000 ký tự).
- "card_hint": Gợi ý nhỏ giúp người dùng nhớ ra đáp án mà không tiết lộ hoàn toàn (≤ 500 ký tự, optional).
- "card_tags": Mảng các từ khóa liên quan đến nội dung thẻ (2–5 tags, lowercase).
- "card_difficulty": Số nguyên từ 1 đến 5, phản ánh mức độ phức tạp của thẻ.

**3. Cấu trúc JSON bắt buộc (Strict Schema):**
Chỉ trả về JSON, không Markdown, không giải thích thêm.

{
  "deck_name": "Tên bộ thẻ học phù hợp với chủ đề",
  "deck_description": "Mô tả ngắn gọn về bộ thẻ học",
  "deck_level": "beginner | intermediate | advanced | expert",
  "deck_language": "${language}",
  "deck_tags": ["tag1", "tag2"],
  "flashcards": [
    {
      "card_front": "Nội dung mặt trước (câu hỏi / thuật ngữ)",
      "card_back": "Nội dung mặt sau (câu trả lời / định nghĩa)",
      "card_hint": "Gợi ý nhỏ (tùy chọn)",
      "card_tags": ["tag1", "tag2"],
      "card_difficulty": ${difficulty}
    }
  ]
}

**4. Dữ liệu đầu vào để phân tích:**
${type === 'text' ? `"""\n${topic}\n"""` : '[Hệ thống sẽ cung cấp file đính kèm, hãy phân tích file đó để tạo flashcard]'}
  `;
};

export const generateQuizzPrompt = (
  text: string,
  type: 'text' | 'document',
  question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text',
  question_max: number,
  question_max_points: number,
) => {
  // Tính toán điểm trung bình mỗi câu để đưa vào prompt cho AI dễ hiểu
  const pointsPerQuestion =
    question_max > 0 ? question_max_points / question_max : 0;

  const questionTypeInstructions = {
    single_choice: `
      - Loại câu hỏi: Trắc nghiệm 1 đáp án đúng.
      - Cấu trúc answers: Phải có 4 đáp án (1 đúng, 3 sai).
      - Logic điểm answers: Đáp án đúng có points = ${pointsPerQuestion}, đáp án sai có points = 0.`,

    multiple_choice: `
      - Loại câu hỏi: Trắc nghiệm nhiều đáp án đúng.
      - Cấu trúc answers: Phải có 4 đáp án (tối thiểu 2 đúng, tối đa 4 đúng).
      - Logic điểm answers: Chia đều điểm câu hỏi (${pointsPerQuestion}) cho số lượng đáp án đúng. Ví dụ: 2 câu đúng thì mỗi câu ${pointsPerQuestion / 2} điểm. Đáp án sai points = 0.`,

    true_false: `
      - Loại câu hỏi: Đúng/Sai.
      - Cấu trúc answers: Phải có 2 đáp án (True và False).
      - Logic điểm answers: Đáp án đúng points = ${pointsPerQuestion}, đáp án sai points = 0.`,

    text: `
      - Loại câu hỏi: Tự luận.
      - Cấu trúc answers: Mảng rỗng [] (Không tạo đáp án giả).
      - Logic điểm: Chỉ set points ở level câu hỏi, không set trong answers.`,
  };

  return `
Role: Bạn là một chuyên gia soạn đề thi và kỹ sư dữ liệu.
Nhiệm vụ: Phân tích nội dung văn bản đầu vào, tạo ra bộ câu hỏi trắc nghiệm và trả về kết quả duy nhất dưới định dạng **Raw JSON**.

**1. Thông số kỹ thuật:**
- Tổng số câu hỏi cần tạo: ${question_max} câu.
- Tổng điểm toàn bài: ${question_max_points} điểm.
- Điểm mỗi câu hỏi (points): ${pointsPerQuestion} điểm. Cho phép số nguyên hoặc số thập phân.
- Loại câu hỏi (question_type): "${question_type}".

**2. Quy tắc logic tạo câu hỏi:**
- Trích xuất các ý chính quan trọng để đặt câu hỏi.
- Tạo "quiz_title" và "quiz_description" ngắn gọn, bao quát nội dung.
- "order": Đánh số thứ tự tăng dần từ 1.
- "explanation": Giải thích ngắn gọn tại sao đáp án đúng.
- Ngôn ngữ: Tiếng Việt (trừ khi văn bản gốc hoàn toàn là tiếng Anh).

**3. Quy tắc chi tiết cho loại câu hỏi "${question_type}":**
${questionTypeInstructions[question_type]}

**4. Cấu trúc JSON bắt buộc (Strict Schema):**
Chỉ trả về JSON, không Markdown, không giải thích thêm.

{
  "quiz_title": "Tiêu đề bài trắc nghiệm",
  "quiz_description": "Mô tả nội dung",
  "quiz_status": "draft",
  "quiz_questions": [
    {
      "question_text": "Nội dung câu hỏi ở đây",
      "question_type": "${question_type}",
      "points": ${pointsPerQuestion},
      "order": 1,
      "explanation": "Giải thích đáp án",
      "answers": [
        {
          "answer_text": "Nội dung đáp án",
          "is_correct": true,
          "points": 10
        }
      ]
    }
  ]
}

**5. Dữ liệu đầu vào để phân tích:**
${type === 'text' ? `"""\n${text}\n"""` : '[Hệ thống sẽ cung cấp file đính kèm, hãy xử lý file đó]'}
  `;
};
