import { UserError } from '@missionsquad/fastmcp'

export function toUserError(error: unknown, prefix: string): UserError {
  if (error instanceof UserError) {
    return error
  }

  if (error instanceof Error) {
    return new UserError(`${prefix}: ${error.message}`)
  }

  return new UserError(`${prefix}: ${String(error)}`)
}

