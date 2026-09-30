package com.emailsystem.service;

import com.opencsv.CSVReader;
import com.opencsv.CSVWriter;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;

@Service
public class FileService {

    private static final Logger log = LoggerFactory.getLogger(FileService.class);

    private static final Map<String, List<String>> COLUMN_MAP = new LinkedHashMap<>();

    static {
        COLUMN_MAP.put("name", List.of("name", "姓名", "客户姓名", "联系人", "contact", "full name"));
        COLUMN_MAP.put("email", List.of("email", "邮箱", "邮件", "e-mail", "email address"));
        COLUMN_MAP.put("company", List.of("company", "公司", "公司名", "公司名称", "organization", "org"));
        COLUMN_MAP.put("phone", List.of("phone", "电话", "手机", "telephone", "tel", "mobile"));
        COLUMN_MAP.put("country", List.of("country", "国家", "地区", "nation"));
        COLUMN_MAP.put("tags", List.of("tags", "标签", "tag"));
        COLUMN_MAP.put("notes", List.of("notes", "备注", "note", "remark"));
    }

    public String normalizeHeader(String header) {
        String h = header.strip().toLowerCase();
        for (var entry : COLUMN_MAP.entrySet()) {
            if (entry.getValue().contains(h)) {
                return entry.getKey();
            }
        }
        return h;
    }

    public List<Map<String, String>> parseFile(String filename, byte[] content) throws IOException {
        String ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
        if (".csv".equals(ext)) {
            return parseCsv(content);
        } else if (".xlsx".equals(ext)) {
            return parseExcel(content);
        }
        return List.of();
    }

    /**
     * 解码 CSV 文本内容。
     *
     * <p>上传的 CSV 有两种常见来源，编码并不统一：
     * <ul>
     *   <li>本系统导出的 CSV：UTF-8 + BOM</li>
     *   <li>中文 Windows 下 Excel「另存为 CSV」：GBK/GB2312（ANSI）</li>
     * </ul>
     * 若一律按 UTF-8 解码，GBK 文件中的中文会变成 U+FFFD 替换字符与随机字符，
     * 且该损坏<b>不可逆</b>（原始字节信息已丢失）。
     *
     * <p>策略：先按 BOM 判定；无 BOM 时尝试严格 UTF-8 解码，
     * 失败则回退 GB18030（GBK/GB2312 的超集）。
     */
    private String decodeCsvText(byte[] content) {
        // ① BOM 判定
        if (content.length >= 3
                && (content[0] & 0xFF) == 0xEF && (content[1] & 0xFF) == 0xBB && (content[2] & 0xFF) == 0xBF) {
            log.debug("CSV 检测到 UTF-8 BOM");
            return new String(content, 3, content.length - 3, StandardCharsets.UTF_8);
        }
        if (content.length >= 2 && (content[0] & 0xFF) == 0xFF && (content[1] & 0xFF) == 0xFE) {
            log.debug("CSV 检测到 UTF-16LE BOM");
            return new String(content, 2, content.length - 2, StandardCharsets.UTF_16LE);
        }
        if (content.length >= 2 && (content[0] & 0xFF) == 0xFE && (content[1] & 0xFF) == 0xFF) {
            log.debug("CSV 检测到 UTF-16BE BOM");
            return new String(content, 2, content.length - 2, StandardCharsets.UTF_16BE);
        }

        // ② 无 BOM：严格尝试 UTF-8，失败则回退 GB18030
        try {
            CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT);
            return decoder.decode(ByteBuffer.wrap(content)).toString();
        } catch (CharacterCodingException e) {
            log.warn("CSV 内容不是合法 UTF-8，按 GB18030 解码（{} 字节）。"
                    + "建议将文件另存为「CSV UTF-8」以消除编码歧义。", content.length);
            return new String(content, Charset.forName("GB18030"));
        }
    }

    private List<Map<String, String>> parseCsv(byte[] content) throws IOException {
        String text = decodeCsvText(content);
        // 兜底：清除解码后可能残留的 BOM 字符（空文件时跳过，避免越界）
        if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
            text = text.substring(1);
        }

        List<Map<String, String>> results = new ArrayList<>();
        try (CSVReader reader = new CSVReader(new StringReader(text))) {
            String[] headers = reader.readNext();
            if (headers == null) return results;

            String[] normalizedHeaders = new String[headers.length];
            for (int i = 0; i < headers.length; i++) {
                normalizedHeaders[i] = normalizeHeader(headers[i]);
            }

            String[] line;
            while ((line = reader.readNext()) != null) {
                Map<String, String> row = new LinkedHashMap<>();
                for (int i = 0; i < normalizedHeaders.length && i < line.length; i++) {
                    if (normalizedHeaders[i] != null && !normalizedHeaders[i].isEmpty()) {
                        row.put(normalizedHeaders[i], (line[i] != null ? line[i].strip() : ""));
                    }
                }
                if (row.get("email") != null && !row.get("email").isEmpty()) {
                    results.add(row);
                }
            }
        } catch (com.opencsv.exceptions.CsvValidationException e) {
            throw new IOException("CSV 解析失败: " + e.getMessage(), e);
        }
        return results;
    }

    private List<Map<String, String>> parseExcel(byte[] content) throws IOException {
        List<Map<String, String>> results = new ArrayList<>();
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(content))) {
            Sheet sheet = wb.getSheetAt(0);
            if (sheet.getPhysicalNumberOfRows() < 2) return results;

            Row headerRow = sheet.getRow(0);
            if (headerRow == null) return results;

            int colCount = headerRow.getLastCellNum();
            String[] normalizedHeaders = new String[colCount];
            for (int i = 0; i < colCount; i++) {
                var cell = headerRow.getCell(i);
                if (cell != null) {
                    normalizedHeaders[i] = normalizeHeader(cell.toString());
                } else {
                    normalizedHeaders[i] = "";
                }
            }

            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                if (row == null) continue;

                Map<String, String> rowData = new LinkedHashMap<>();
                for (int i = 0; i < colCount; i++) {
                    if (normalizedHeaders[i] != null && !normalizedHeaders[i].isEmpty()) {
                        var cell = row.getCell(i);
                        String value = "";
                        if (cell != null) {
                            value = cell.toString().strip();
                        }
                        rowData.put(normalizedHeaders[i], value);
                    }
                }
                if (rowData.get("email") != null && !rowData.get("email").isEmpty()) {
                    results.add(rowData);
                }
            }
        }
        return results;
    }

    public void exportCsv(List<Map<String, String>> customers, HttpServletResponse response) throws IOException {
        response.setContentType("text/csv; charset=UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=customers.csv");

        OutputStream os = response.getOutputStream();
        os.write(0xEF);
        os.write(0xBB);
        os.write(0xBF);

        try (CSVWriter writer = new CSVWriter(new OutputStreamWriter(os, StandardCharsets.UTF_8))) {
            String[] fieldnames = {"customer_no", "name", "email", "company", "phone", "country", "tags", "notes"};
            writer.writeNext(fieldnames);
            for (Map<String, String> c : customers) {
                String[] row = new String[fieldnames.length];
                for (int i = 0; i < fieldnames.length; i++) {
                    row[i] = c.getOrDefault(fieldnames[i], "");
                }
                writer.writeNext(row);
            }
        }
    }

    public void exportExcel(List<Map<String, String>> customers, HttpServletResponse response) throws IOException {
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=customers.xlsx");

        try (Workbook wb = new XSSFWorkbook()) {
            Sheet sheet = wb.createSheet("Customers");
            String[] headers = {"Customer No", "Name", "Email", "Company", "Phone", "Country", "Tags", "Notes"};
            String[] fields = {"customer_no", "name", "email", "company", "phone", "country", "tags", "notes"};

            Row headerRow = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                headerRow.createCell(i).setCellValue(headers[i]);
            }

            int rowNum = 1;
            for (Map<String, String> c : customers) {
                Row row = sheet.createRow(rowNum++);
                for (int i = 0; i < fields.length; i++) {
                    row.createCell(i).setCellValue(c.getOrDefault(fields[i], ""));
                }
            }

            wb.write(response.getOutputStream());
        }
    }

    public void exportImportTemplate(HttpServletResponse response) throws IOException {
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=customer_import_template.xlsx");

        try (Workbook wb = new XSSFWorkbook()) {
            Sheet sheet = wb.createSheet("客户导入模板");
            String[] headers = {"姓名", "邮箱", "公司", "电话", "国家", "标签", "备注"};

            Row headerRow = sheet.createRow(0);
            var headerStyle = wb.createCellStyle();
            var font = wb.createFont();
            font.setBold(true);
            headerStyle.setFont(font);
            for (int i = 0; i < headers.length; i++) {
                var cell = headerRow.createCell(i);
                cell.setCellValue(headers[i]);
                cell.setCellStyle(headerStyle);
                sheet.setColumnWidth(i, 5000);
            }

            Row sampleRow = sheet.createRow(1);
            sampleRow.createCell(0).setCellValue("张三");
            sampleRow.createCell(1).setCellValue("zhangsan@example.com");
            sampleRow.createCell(2).setCellValue("示例公司");
            sampleRow.createCell(3).setCellValue("+86-138-0000-0000");
            sampleRow.createCell(4).setCellValue("中国");
            sampleRow.createCell(5).setCellValue("VIP");
            sampleRow.createCell(6).setCellValue("示例备注");

            wb.write(response.getOutputStream());
        }
    }
}
