import { get } from 'node:https'

export interface DownloadResponse {
  status: number
  bytes: Buffer
}

export function signingRequest(
  url: URL | string,
  options: {
    headers?: Record<string, string>
    signal?: AbortSignal
    maxBytes?: number
  } = {},
): Promise<DownloadResponse> {
  return new Promise((resolve, reject) => {
    const request = get(url, options, response => {
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > (options.maxBytes ?? 128 * 1024 * 1024)) {
          response.destroy(new Error('Signing download exceeds size limit'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          bytes: Buffer.concat(chunks),
        }),
      )
      response.on('error', reject)
    })
    // No redirects: credentials must only reach the exact GitHub endpoint.
    request.on('error', reject)
  })
}
