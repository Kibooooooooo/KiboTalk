export type SseMessage = { event: string; data: string }

/**
 * Parse a streaming SSE Response into {event, data} messages.
 * Multi-line `data:` fields (per SSE spec / Hono writeSSE) are joined with `\n`.
 * A blank line ends the current event.
 */
export async function* parseSseStream(res: Response): AsyncGenerator<SseMessage> {
  if (!res.body) throw new Error('SSE response has no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'
  let dataLines: string[] = []

  function flush(): SseMessage | null {
    if (dataLines.length === 0) {
      event = 'message'
      return null
    }
    const msg = { event, data: dataLines.join('\n') }
    event = 'message'
    dataLines = []
    return msg
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)

      if (line === '') {
        const msg = flush()
        if (msg) yield msg
        continue
      }
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        event = line.slice(6).trimStart()
      } else if (line.startsWith('data:')) {
        const payload = line.slice(5)
        dataLines.push(payload.startsWith(' ') ? payload.slice(1) : payload)
      }
    }
  }
  const trailing = flush()
  if (trailing) yield trailing
}
