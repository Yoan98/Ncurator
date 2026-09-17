import { createHmac, createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_CLIENT_HEADER,
  APP_NONCE_HEADER,
  APP_SIGNATURE_HEADER,
  APP_TIMESTAMP_HEADER,
  buildAppGatewaySignaturePayload,
  buildDesktopAppGatewayHeaders
} from '../../../../src/main/services/officialApi/appClient'
import { readJwtExpiryMs } from '../../../../src/main/services/officialApi/mysteryToken'

const originalSecret = process.env.NCURATOR_APP_SECRET_DESKTOP

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NCURATOR_APP_SECRET_DESKTOP
  else process.env.NCURATOR_APP_SECRET_DESKTOP = originalSecret
})

describe('desktop app gateway headers', () => {
  it('omits HMAC headers when the desktop secret is missing', () => {
    delete process.env.NCURATOR_APP_SECRET_DESKTOP
    expect(
      buildDesktopAppGatewayHeaders({
        method: 'GET',
        url: 'https://www.guanzhangai.cn/api/v1/free-models'
      })
    ).toEqual({})
  })

  it('signs method, path, timestamp, nonce and body hash', () => {
    process.env.NCURATOR_APP_SECRET_DESKTOP = 'unit-test-secret'
    const headers = buildDesktopAppGatewayHeaders({
      method: 'POST',
      url: 'https://www.guanzhangai.cn/api/v1/mystery-token',
      body: ''
    })
    expect(headers[APP_CLIENT_HEADER]).toBe('desktop')
    expect(headers[APP_TIMESTAMP_HEADER]).toMatch(/^\d+$/)
    expect(headers[APP_NONCE_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    const payload = buildAppGatewaySignaturePayload({
      method: 'POST',
      path: '/api/v1/mystery-token',
      timestamp: headers[APP_TIMESTAMP_HEADER],
      nonce: headers[APP_NONCE_HEADER],
      body: ''
    })
    const expected = createHmac('sha256', 'unit-test-secret').update(payload, 'utf8').digest('hex')
    expect(headers[APP_SIGNATURE_HEADER]).toBe(expected)
    expect(payload.split('\n')[4]).toBe(createHash('sha256').update('', 'utf8').digest('hex'))
  })
})

describe('mystery token expiry', () => {
  it('reads exp from an unsigned JWT payload', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    expect(readJwtExpiryMs(`aaa.${payload}.bbb`)).toBe(1_800_000_000 * 1000)
  })
})
