# Resume Export Package

这是张国鑫个人简历站导出的结构化简历数据包。

## Package Metadata

- packageVersion: `resume-data-package@v4`
- packageType: `resume-data-export`
- exportedAt: `2026-04-02T12:33:00.815Z`
- sourceSite: `https://zgx197.top`
- sourceResumePath: `/resume`

## Included Files

- `resume.json`: 当前简历的标准结构化数据，适合程序直接读取。
- `resume.meta.json`: 当前导出包的背景说明、顶层字段说明和字段语义提示。
- `resume.schema.json`: 字段结构、枚举值和类型约束说明。
- `README.md`: 当前说明文件。

## Recommended Reading Order

1. 先阅读 `README.md`，理解这个压缩包的定位和文件用途。
2. 再阅读 `resume.meta.json`，理解顶层字段和基础语义说明。
3. 再阅读 `resume.schema.json`，理解结构、类型和枚举约束。
4. 最后消费 `resume.json`，把它当成完整事实层数据。

## Important Notes

- 这份数据包只导出简历事实和基础说明，不预设任何外部系统的消费行为。
- 如果需要生成摘要、问答、评分或其他推断结果，建议在外部系统中自行完成。
- 如需获得完整事实数据，请以 `resume.json` 为准。
