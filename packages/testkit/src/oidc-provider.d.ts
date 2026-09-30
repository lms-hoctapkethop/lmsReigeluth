declare module 'oidc-provider' {
  import type { IncomingMessage, ServerResponse } from 'node:http'

  export class Provider {
    constructor(issuer: string, configuration: Record<string, unknown>)
    callback(): (req: IncomingMessage, res: ServerResponse) => void
    interactionDetails(req: IncomingMessage, res: ServerResponse): Promise<{
      params: { client_id?: string }
      prompt: { name: string }
    }>
    interactionFinished(
      req: IncomingMessage,
      res: ServerResponse,
      result: Record<string, unknown>,
      options?: { mergeWithLastSubmission?: boolean },
    ): Promise<void>
    Grant: {
      new (args: { accountId: string; clientId: string }): {
        addOIDCScope(scope: string): void
        save(): Promise<string>
      }
    }
  }

  export default Provider
}
