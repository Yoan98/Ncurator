export type AppSettingsErrorCode =
  | 'invalid_language'
  | 'invalid_service_route'
  | 'invalid_index_speed'
  | 'invalid_notification_setting'

export class AppSettingsError extends Error {
  public constructor(public readonly code: AppSettingsErrorCode) {
    super(code)
  }
}
