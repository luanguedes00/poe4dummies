// Cliente HTTP mínimo: User-Agent identificado (pedido da GGG), tempo limite,
// validação do JSON com zod e erros com código (a interface traduz).

import type { ZodType } from 'zod'
import { RateLimitedError, type LimitedResponse, type RateLimiter } from './rateLimiter'

export type ApiErrorCode = 'network' | 'timeout' | 'rate-limited' | 'http' | 'invalid-response'

export class ApiError extends Error {
  override name = 'ApiError'
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number | null = null,
    /** Para 'rate-limited': quantos segundos esperar. */
    readonly retryAfterSec: number | null = null,
  ) {
    super(status === null ? code : `${code} (${status})`)
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface HttpClientOptions {
  userAgent: string
  timeoutMs?: number
  fetch?: FetchLike
}

interface RequestOptions<T> {
  schema: ZodType<T>
  method?: 'GET' | 'POST'
  body?: unknown
  /** Política de rate limit (quando o servidor informa limites). */
  limiter?: { instance: RateLimiter; key: string; background?: boolean }
}

interface RawResponse extends LimitedResponse {
  bodyText: string
}

export class HttpClient {
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init))
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  private async send(url: string, method: 'GET' | 'POST', body: unknown, accept = 'application/json'): Promise<RawResponse> {
    const headers: Record<string, string> = {
      'User-Agent': this.options.userAgent,
      Accept: accept,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      })
    } catch (error) {
      const name = (error as { name?: string } | null)?.name
      throw new ApiError(name === 'TimeoutError' ? 'timeout' : 'network')
    }
    return { status: response.status, headers: response.headers, bodyText: await response.text() }
  }

  async request<T>(url: string, options: RequestOptions<T>): Promise<T> {
    const method = options.method ?? 'GET'
    const run = () => this.send(url, method, options.body)
    const limiter = options.limiter
    let raw: RawResponse
    try {
      raw = !limiter
        ? await run()
        : limiter.background
          ? await limiter.instance.runBackground(limiter.key, run)
          : await limiter.instance.run(limiter.key, run)
    } catch (error) {
      if (error instanceof RateLimitedError) throw new ApiError('rate-limited', 429, error.retryAfterSec)
      throw error
    }

    if (raw.status === 429) {
      const retry = Number(raw.headers.get('retry-after'))
      throw new ApiError('rate-limited', 429, Number.isFinite(retry) ? retry : null)
    }
    if (raw.status < 200 || raw.status >= 300) throw new ApiError('http', raw.status)

    let json: unknown
    try {
      json = JSON.parse(raw.bodyText)
    } catch {
      throw new ApiError('invalid-response', raw.status)
    }
    const parsed = options.schema.safeParse(json)
    if (!parsed.success) throw new ApiError('invalid-response', raw.status)
    return parsed.data
  }

  /** GET de texto puro (ex.: código de build), com tamanho máximo. */
  async requestText(url: string, maxLength: number): Promise<string> {
    const raw = await this.send(url, 'GET', undefined, 'text/plain, */*')
    if (raw.status === 429) throw new ApiError('rate-limited', 429, null)
    if (raw.status < 200 || raw.status >= 300) throw new ApiError('http', raw.status)
    if (raw.bodyText.length > maxLength) throw new ApiError('invalid-response', raw.status)
    return raw.bodyText
  }
}
