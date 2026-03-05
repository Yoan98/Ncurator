capability/docx 用例默认已提供示例文件，可直接执行测试。

当前首个用例默认读取：

- `tests/ai/fixtures/docx/sample-edit.docx`

要求：

- 文档中至少包含字符串 `Hello`，用例会验证替换为 `Hi` 的流程。

如果该文件被删除，测试运行器会在执行前 fail-fast 并输出缺失路径。
