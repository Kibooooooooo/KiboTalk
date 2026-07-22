export type SseMessage = { event: string; data: string }

/** Parse a streaming SSE Response into {event, data} messages. */
export async function* parseSseStream(res: Response): AsyncGenerator<SseMessage> {
  if (!res.body) throw new Error('SSE response has no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        yield { event, data: line.slice(5).trim() }
        event = 'message'
      }
    }
  }
}
