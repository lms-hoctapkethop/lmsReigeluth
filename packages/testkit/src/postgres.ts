import { PostgreSqlContainer } from '@testcontainers/postgresql'

export async function startPostgres18(): Promise<{ url: string; stop: () => Promise<void> }> {
  const started = await new PostgreSqlContainer('postgres:18').start()
  return {
    url: started.getConnectionUri(),
    stop: async () => {
      await started.stop()
    },
  }
}
