import * as Task from "./api.js"
import { current, suspend } from "./scheduler.js"

/**
 * @template {{}} T
 * @param {T[]} buffer
 * @returns {Task.Channel<T>}
 */
export const open = (buffer = []) => new Channel(buffer)

/**
 * @template {{}} T
 * @implements {Task.Channel<T>}
 */
class Channel {
  /**
   * @param {T[]} buffer
   */
  constructor(buffer = []) {
    /** @type {"open"|"closed"} */
    this.status = "open"
    this.buffer = buffer
    /** @type {Task.Workflow<*, *, *>[]} */
    this.readQueue = []
  }
  /**
   * @param {T} message
   */
  put(message) {
    if (this.status === "open") {
      this.buffer.push(message)
      const work = this.readQueue.shift()
      if (work) {
        work.resume()
      }
    } else {
      throw new Error("Channel is closed")
    }
  }

  *take() {
    const { buffer, readQueue } = this
    while (this.status === "open" && buffer.length === 0) {
      readQueue.push(current())
      yield* suspend()
    }

    return buffer.shift()
  }

  close() {
    this.status = "closed"
    if (this.buffer.length === 0) {
      for (const work of this.readQueue) {
        work.resume()
      }
      this.readQueue.length = 0
    }
  }
}
