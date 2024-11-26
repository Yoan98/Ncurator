//TODO
// 实现思路
// 使用pptxtojson将pptx文件转换为json格式,https://github.com/pipipi-pikachu/pptxtojson?tab=readme-ov-file
// 所得的json数据是带有html标签格式的，且是散装的,需要主动拼装成整块html抛出去,
// 然后在connection类中使用langchain将html转成文本再分割,https://js.langchain.com/docs/integrations/document_transformers/html-to-text
// html-to-text可能不支持浏览器版,试试https://js.langchain.com/docs/integrations/document_transformers/mozilla_readability