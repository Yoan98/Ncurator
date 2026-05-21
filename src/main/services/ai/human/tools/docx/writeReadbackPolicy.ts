import type { DocxWriteReadbackAction, DocxWriteReadbackWindowPolicy } from './types'

export const DOCX_POST_WRITE_READBACK_WINDOW_POLICY: Record<
  DocxWriteReadbackAction,
  DocxWriteReadbackWindowPolicy
> = {
  create_document: {
    beforeBlockCount: 0,
    afterBlockCount: 20
  },
  insert_before: {
    beforeBlockCount: 2,
    afterBlockCount: 2
  },
  insert_after: {
    beforeBlockCount: 2,
    afterBlockCount: 2
  },
  replace_block: {
    beforeBlockCount: 2,
    afterBlockCount: 2
  },
  delete_block: {
    beforeBlockCount: 3,
    afterBlockCount: 3
  },
  update_table_cell: {
    beforeBlockCount: 1,
    afterBlockCount: 1
  },
  replace_text: {
    beforeBlockCount: 2,
    afterBlockCount: 2
  },
  style_text: {
    beforeBlockCount: 1,
    afterBlockCount: 1
  }
}
