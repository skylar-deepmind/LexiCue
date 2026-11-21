# 文件导入样本

这些是专为回归测试编写的英文素材。`expected.json` 独立记录预期正文、PDF 单页结果、字幕时间和错误。每份原文件都经过应用使用的提取器，逐字比较正文与段落边界。

| 原文件 | 验收点 |
| --- | --- |
| `harbor-two-pages.pdf` | 两页重复页眉和页脚含变动页码。合并段内排版换行与跨页续句，恢复 `recovered`，保留 `well-known`。仅选一页只取该页文字。 |
| `garden-columns.pdf` | 通栏标题后先读左栏，再读右栏，移除页脚的页码。 |
| `image-only.pdf` | 只有位图。返回缺少文字层的错误。 |
| `market-spine.epub` | 按书脊顺序读章节。保留章节标题，去掉目录、页码标记、脚注引用及原注、隐藏文字和版权页脚。 |
| `field-notes.docx` | 保留标题、手动折行、最终可见修订、表格行。去掉页眉、页脚、划掉的文字和脚注。 |
| `morning-cues.srt` | UTF-16 BOM 和 CRLF。去掉排版标签，合并重叠滚动字幕，保留隔时重复的对白、中英对照与方括号提示，并核对句子的起止时间。 |
| `timed-voices.vtt` | 从带说话人标签和对齐设置的字幕提取对白，排除注释和样式。 |
| `walking-notes.md` | 保留标题、链接文字、列表内容。排除 URL 和装饰图片。 |
| `station.txt` | 混用 UTF-8 BOM、CRLF 和空段落，保留原有的句子和段落。 |

运行 `npx vitest run src/lib/__tests__/documentBodyFixtures.test.ts` 可复现正文对照。运行 `node scripts/ui-import-smoke.mjs` 可验证导入预览和存储，需要先启动本项目的 Vite 服务。
