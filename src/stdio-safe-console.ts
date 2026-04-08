import { format, inspect, type InspectOptions } from 'node:util'

function writeLineToStderr(line: string): void {
  process.stderr.write(`${line}\n`)
}

function writeArgsToStderr(...args: unknown[]): void {
  writeLineToStderr(format(...args))
}

export function routeConsoleStdoutToStderr(): void {
  console.log = (...args: unknown[]): void => {
    writeArgsToStderr(...args)
  }
  console.info = (...args: unknown[]): void => {
    writeArgsToStderr(...args)
  }
  console.debug = (...args: unknown[]): void => {
    writeArgsToStderr(...args)
  }
  console.dir = (item: unknown, options?: InspectOptions): void => {
    writeLineToStderr(inspect(item, options))
  }
}

