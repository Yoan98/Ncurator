import type { Migration } from './types'

export const llmManualModelsMigration: Migration = {
  version: 22,
  name: 'llm_manual_models',
  sql: `
ALTER TABLE llm_config ADD COLUMN manual_models_json TEXT NOT NULL DEFAULT '[]';
UPDATE llm_config SET manual_models_json = (
  SELECT json_group_array(DISTINCT json_extract(state_json, '$.composer.modelSelection.mainModel.modelName'))
  FROM partner_ui_state
  WHERE json_extract(state_json, '$.composer.modelSelection.mainModel.manual') = 1
    AND json_extract(state_json, '$.composer.modelSelection.mainModel.configId') = llm_config.id
    AND trim(json_extract(state_json, '$.composer.modelSelection.mainModel.modelName')) <> ''
);
`
}
