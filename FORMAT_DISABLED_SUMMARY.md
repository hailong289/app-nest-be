# Tóm tắt thay đổi - Loại bỏ check lỗi bắt buộc format

## Các thay đổi đã thực hiện:

### 1. ESLint Configuration (eslint.config.mjs)
- ✅ Loại bỏ `eslintPluginPrettierRecommended` 
- ✅ Tắt các rules liên quan đến formatting:
  - `prettier/prettier: 'off'`
  - `no-multiple-empty-lines: 'off'`
  - `no-trailing-spaces: 'off'`
  - `eol-last: 'off'`
  - `comma-dangle: 'off'`
  - `quotes: 'off'`
  - `semi: 'off'`
  - `indent: 'off'`

### 2. Package.json Scripts
- ✅ Thay đổi `lint` script để không auto-fix: `eslint "{src,apps,libs,test}/**/*.ts"`
- ✅ Thêm `lint:fix` script riêng: `eslint "{src,apps,libs,test}/**/*.ts" --fix`  
- ✅ Thay đổi `format` script thành thông báo: `echo "Formatting đã được tắt..."`
- ✅ Thêm `format:check` script thông báo

### 3. Prettier Configuration
- ✅ Tạo file `.prettierignore` để bỏ qua tất cả file (`*` và `**/*`)
- 📁 Giữ nguyên file `.prettierrc` (có thể xóa nếu muốn)

## Kết quả:
- ❌ **Không còn lỗi formatting** khi chạy `npm run lint`
- ❌ **Không còn auto-format** khi chạy `npm run format`
- ✅ **Vẫn có type checking** và logic linting từ TypeScript ESLint
- ✅ **Có thể manual fix** bằng `npm run lint:fix` nếu cần

## Commands để test:
```bash
npm run lint        # Chỉ báo lỗi logic/type, không format
npm run format      # Hiển thị thông báo đã tắt
npm run lint:fix    # Manual fix các lỗi có thể tự động sửa
```

## Note:
- Các lỗi TypeScript vẫn được báo (unsafe-assignment, no-unsafe-return, etc.)
- Formatting rules đã được tắt hoàn toàn
- Developer có thể code theo style tùy ý mà không bị warning/error